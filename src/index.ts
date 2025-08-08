#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Client as SSHClient, ClientChannel } from 'ssh2';
import { z } from 'zod';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

// Example usage (SSE):
//   node build/index.js --transport=sse --listenPort=3001 --host=1.2.3.4 --sshPort=22 --user=root --password=pass --timeout=5000
// Example usage (HTTP Stream):
//   node build/index.js --transport=stream --listenPort=3001 --host=1.2.3.4 --sshPort=22 --user=root --password=pass
// Your sample (with two --port flags) works because the second --port overrides the first and listenPort falls back to default 3001.
// Prefer using --listenPort (or alias --httpPort) for the HTTP server and --sshPort for the remote host port.
// Supported flags:
//   --transport=sse|stream   (default: stream)
//   --listenPort=<number>    (HTTP listening port, default: 3001) (alias: --httpPort)
//   --listenHost=<host>      (HTTP listening host, default: 127.0.0.1)
//   --host=<ssh host>        (required)
//   --sshPort=<ssh port>     (preferred explicit ssh port)
//   --port=<ssh port>        (legacy alias for --sshPort)
//   --user=<ssh user>        (required)
//   --password=<ssh password>
//   --key=<path to private key>
//   --timeout=<ms>           (command timeout; default 60000)
function parseArgv() {
  const args = process.argv.slice(2);
  const config: Record<string, string | undefined> = {};
  for (const raw of args) {
    if (!raw.startsWith('--')) continue;
    const trimmed = raw.slice(2);
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    config[key] = value;
  }
  return config;
}
const argvConfig = parseArgv();
// Backwards compatibility / aliases:
if (argvConfig.httpPort && !argvConfig.listenPort) {
  argvConfig.listenPort = argvConfig.httpPort;
}

// Listening (HTTP) server config
const LISTEN_PORT = argvConfig.listenPort ? parseInt(argvConfig.listenPort) : 3001;
const LISTEN_HOST = argvConfig.listenHost || '127.0.0.1';
const TRANSPORT = (argvConfig.transport || 'stream').toLowerCase(); // 'sse' | 'stream'

// Environment / runtime security & tuning options
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(o => o.trim());
const REQUIRE_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';
const MAX_SESSION_AGE_MS = process.env.MCP_MAX_SESSION_AGE_MS ? parseInt(process.env.MCP_MAX_SESSION_AGE_MS) : (30 * 60 * 1000); // 30m default
const KEEPALIVE_INTERVAL_MS = process.env.MCP_KEEPALIVE_INTERVAL_MS ? parseInt(process.env.MCP_KEEPALIVE_INTERVAL_MS) : 30_000; // 30s
// Security: relaxed by default for local development. Enable protection via:
//   * CLI flag: --strictSecurity=true (or 1)
//   * Env var: ENABLE_DNS_REBIND=1
//   * NODE_ENV=production
// Previous env DISABLE_DNS_REBIND is deprecated (still honored if set to '1').
const STRICT_SECURITY_FLAG = (argvConfig as any)?.strictSecurity === '1' || (argvConfig as any)?.strictSecurity === 'true';
const ENABLE_DNS_REBIND_PROTECTION = (
  STRICT_SECURITY_FLAG ||
  process.env.ENABLE_DNS_REBIND === '1' ||
  process.env.NODE_ENV === 'production'
) && process.env.DISABLE_DNS_REBIND !== '1';
const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';
const SSH_DEBUG = process.env.MCP_SSH_DEBUG === '1';

// Logging configuration
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_JSON = process.env.MCP_LOG_JSON === '1';
const LOG_TIMING = process.env.MCP_DEBUG_TIMING === '1';
const LOG_RPC_BODIES = process.env.MCP_LOG_RPC === '1';
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
const levelRank: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
function shouldLog(level: LogLevel) {
  const current = (levelRank as any)[LOG_LEVEL] ?? 30;
  return levelRank[level] >= current && current <= 50; // always allow error
}
function log(level: LogLevel, msg: string, meta?: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!shouldLog(level)) return;
  if (LOG_JSON) {
    const out: any = { ts: new Date().toISOString(), level, msg, ...meta }; // eslint-disable-line @typescript-eslint/no-explicit-any
    console.error(JSON.stringify(out));
  } else {
    const extra = meta ? ' ' + JSON.stringify(meta) : '';
    console.error(`[${level.toUpperCase()}] ${msg}${extra}`);
  }
}
process.on('unhandledRejection', (reason: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  log('error', 'UnhandledRejection', { reason: String(reason) });
});
process.on('uncaughtException', (err: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  log('error', 'UncaughtException', { error: err?.message, stack: err?.stack });
});

// SSH target config
const HOST = argvConfig.host;
// Prefer explicit sshPort, then legacy port
const PORT = argvConfig.sshPort ? parseInt(argvConfig.sshPort) : (argvConfig.port ? parseInt(argvConfig.port) : 22);
const USER = argvConfig.user;
const PASSWORD = argvConfig.password;
const KEY = argvConfig.key;
const DEFAULT_TIMEOUT = argvConfig.timeout ? parseInt(argvConfig.timeout) : 60000; // 60 seconds default timeout

function validateConfig(config: Record<string, string | undefined>) {
  const errors: string[] = [];
  if (!config.host) errors.push('Missing required --host');
  if (!config.user) errors.push('Missing required --user');
  if (config.port && isNaN(Number(config.port))) errors.push('Invalid --port');
  if (config.listenPort && isNaN(Number(config.listenPort))) errors.push('Invalid --listenPort');
  if (config.sshPort && isNaN(Number(config.sshPort))) errors.push('Invalid --sshPort');
  if (config.transport && !['sse', 'stream'].includes(config.transport.toLowerCase())) errors.push('Invalid --transport (expected sse|stream)');
  if (errors.length > 0) throw new Error('Configuration error:\n' + errors.join('\n'));
}
validateConfig(argvConfig);

/**
 * Create a new MCP server instance with the SSH exec tool registered.
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'SSH MCP Server',
    version: '1.1.0',
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // (Soft) protocol version enforcement/logging: if client supplies mismatched protocolVersion we can warn.
  // The SDK currently handles initialize; we can hook into requests via a lightweight wrapper by
  // exposing a tool for diagnostics if needed. For now just log first initialize result using a one-time flag.
  let initializedLogged = false;
  (server as any).on?.('initialized', (params: any) => {
    if (!initializedLogged) {
      initializedLogged = true;
      const clientVersion = params?.protocolVersion;
      if (clientVersion && clientVersion !== SUPPORTED_PROTOCOL_VERSION) {
  log('warn', 'Protocol version mismatch', { clientVersion, supported: SUPPORTED_PROTOCOL_VERSION });
      } else {
  log('info', 'Initialized', { protocolVersion: clientVersion || 'UNKNOWN' });
      }
    }
  });

  server.tool(
    "exec",
    "Execute a shell command on the remote SSH server and return the output.",
    {
      command: z.string().describe("Shell command to execute on the remote SSH server"),
    },
  async ({ command }: { command: string }) => {
      const start = performance.now();
      log('debug', 'Tool exec start', { command });
      if (typeof command !== 'string' || !command.trim()) {
        throw new McpError(ErrorCode.InternalError, 'Command must be a non-empty string.');
      }
      // Optional: execute locally instead of SSH if MCP_LOCAL_EXEC=1 (diagnostic / fallback)
      if (process.env.MCP_LOCAL_EXEC === '1') {
        return execLocalCommand(command, start);
      }
      // Quick TCP preflight (unless skipped) to give a clearer error than a generic handshake failure
      if (process.env.MCP_SKIP_SSH_PREFLIGHT !== '1') {
        try {
          const reachable = await tcpPreflight(HOST || '127.0.0.1', PORT, 3000);
          if (!reachable.ok) {
            let errorMsg = `SSH port check failed (${reachable.reason}). `;
            if (reachable.reason?.includes('refused') && PORT === 22) {
              errorMsg += `If using Docker, try --sshPort=2222 (common Docker SSH mapping). `;
            }
            errorMsg += `Ensure an SSH server is listening on ${HOST}:${PORT} or set MCP_LOCAL_EXEC=1 for local commands.`;
            throw new McpError(ErrorCode.InternalError, errorMsg);
          }
        } catch (e: any) {
          if (e instanceof McpError) throw e;
          throw new McpError(ErrorCode.InternalError, `SSH preflight error: ${e?.message || e}`);
        }
      }
      const sshConfig: any = { host: HOST, port: PORT, username: USER };
      try {
        if (PASSWORD) {
          sshConfig.password = PASSWORD;
        } else if (KEY) {
          const fs = await import('fs/promises');
          sshConfig.privateKey = await fs.readFile(KEY, 'utf8');
        }
        const result = await execSshCommand(sshConfig, command);
        const dur = performance.now() - start;
        if (LOG_TIMING) log('debug', 'Tool exec complete', { ms: Math.round(dur), commandLength: command.length });
        return result;
      } catch (err: any) {
        const dur = performance.now() - start;
        log('error', 'Tool exec error', { ms: Math.round(dur), error: err?.message });
        if (err instanceof McpError) throw err;
        throw new McpError(ErrorCode.InternalError, `Unexpected error: ${err?.message || err}`);
      }
    }
  );

  // Diagnostics tool
  server.tool(
    'server_info',
    'Return diagnostic information about the server.',
    {},
    async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            transport: TRANSPORT,
            host: HOST,
            sshPort: PORT,
            protocolSupported: SUPPORTED_PROTOCOL_VERSION,
            now: new Date().toISOString(),
          }, null, 2)
        }]
      };
    }
  );

  return server;
}

type ToolResult = { content: { type: 'text'; text: string }[] };
async function tcpPreflight(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
  const net = await import('node:net');
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean, reason?: string) => {
      if (done) return; done = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, reason });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'timeout'));
    socket.once('error', (err: Error) => finish(false, err.message.includes('ECONNREFUSED') ? 'connection refused' : err.message));
    try { socket.connect(port, host); } catch (e: any) { finish(false, e?.message || 'connect exception'); }
  });
}
async function execLocalCommand(command: string, start: number): Promise<ToolResult> {
  const { exec } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    exec(command, { timeout: DEFAULT_TIMEOUT }, (err, stdout, stderr) => {
      const dur = performance.now() - start;
      if (err) {
        log('error', 'Local exec error', { ms: Math.round(dur), error: err.message, stderr: stderr?.slice(0, 200) });
        reject(new McpError(ErrorCode.InternalError, `Local exec failed: ${stderr || err.message}`));
        return;
      }
      log('debug', 'Local exec complete', { ms: Math.round(dur) });
      resolve({ content: [{ type: 'text', text: stdout }] });
    });
  });
}
async function execSshCommand(sshConfig: any, command: string): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    let timeoutId: NodeJS.Timeout;
    let isResolved = false;
    // Optional raw TCP preflight if SSH_DEBUG to distinguish unreachable vs handshake failure
    if (SSH_DEBUG) {
      try {
        const net = require('node:net');
        const sock = new net.Socket();
        sock.setTimeout(5000);
        sock.on('connect', () => { log('debug', 'TCP preflight connected'); sock.destroy(); });
        sock.on('timeout', () => { log('warn', 'TCP preflight timeout'); sock.destroy(); });
        sock.on('error', (e: Error) => { log('warn', 'TCP preflight error', { error: e.message }); });
        sock.connect(sshConfig.port, sshConfig.host);
      } catch {}
    }
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        // Try to abort the running command before closing connection
        const abortTimeout = setTimeout(() => {
          // If abort command itself times out, force close connection
          conn.end();
        }, 5000); // 5 second timeout for abort command
        
        conn.exec('timeout 3s pkill -f "' + command + '" 2>/dev/null || true', (err: Error | undefined, abortStream: ClientChannel | undefined) => {
          if (abortStream) {
            abortStream.on('close', () => {
              clearTimeout(abortTimeout);
              conn.end();
            });
          } else {
            clearTimeout(abortTimeout);
            conn.end();
          }
        });
        reject(new McpError(ErrorCode.InternalError, `Command execution timed out after ${DEFAULT_TIMEOUT}ms`));
      }
    }, DEFAULT_TIMEOUT);
    
    if (SSH_DEBUG) {
      log('debug', 'SSH connect attempt', {
        host: sshConfig.host,
        port: sshConfig.port,
        user: sshConfig.username,
        auth: sshConfig.privateKey ? 'key' : (sshConfig.password ? 'password' : 'unknown'),
      });
    }

    conn.on('banner', (msg: string) => {
      if (SSH_DEBUG) log('debug', 'SSH banner', { banner: msg.slice(0, 200) });
    });
    conn.on('end', () => {
      if (SSH_DEBUG) log('debug', 'SSH end event');
    });
    // 'close' event is emitted with optional hadError flag; typing may vary across ssh2 versions
    (conn as any).on('close', (hadErr: boolean) => {
      if (SSH_DEBUG) log('debug', 'SSH close event', { hadError: hadErr });
    });
    (conn as any).on('greeting', (name: string, instructions: string) => {
      if (SSH_DEBUG) log('debug', 'SSH greeting', { name, instructions: instructions?.slice(0, 100) });
    });
    (conn as any).on('handshake', (negotiated: any) => {
      if (SSH_DEBUG) log('debug', 'SSH handshake negotiated', { algorithms: negotiated });
    });
    conn.on('ready', () => {
      if (SSH_DEBUG) log('debug', 'SSH ready (handshake complete)');
      conn.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        if (err) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            reject(new McpError(ErrorCode.InternalError, `SSH exec error: ${err.message}`));
          }
          conn.end();
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number, signal: string) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            conn.end();
            if (stderr) {
              reject(new McpError(ErrorCode.InternalError, `Error (code ${code}):\n${stderr}`));
            } else {
              resolve({
                content: [{
                  type: 'text',
                  text: stdout,
                }],
              });
            }
          }
        });
    stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
    stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  conn.on('error', (err: Error) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);
        reject(new McpError(ErrorCode.InternalError, `SSH connection error: ${err.message}`));
      }
    });
    // Inject low-level debug hook if enabled
    if (SSH_DEBUG) {
      sshConfig.debug = (info: string) => {
        // Filter very chatty keepalive noise but log handshake/auth phases
        if (/DEBUG:/.test(info) || /parser|plaintext|Outgoing|Incoming/.test(info)) return; // example filtering
        log('trace', 'ssh2-debug', { info });
      };
    }
    try {
      conn.connect(sshConfig);
    } catch (e: any) {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);
        reject(new McpError(ErrorCode.InternalError, `SSH connect threw: ${e?.message || e}`));
      }
    }
  });
}

async function startSseServer() {
  const app = express();
  // Capture raw body for diagnostics
  app.use(express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }));
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return cb(null, origin || true);
      return cb(new Error('Origin not allowed by CORS'));
    },
    allowedHeaders: ['Content-Type', 'mcp-session-id', 'Mcp-Session-Id', 'Authorization'],
    exposedHeaders: ['Mcp-Session-Id'],
    credentials: false,
  }));

  interface SessionInfo {
    transport: SSEServerTransport;
    createdAt: number;
    lastActivity: number;
    keepAliveTimer?: NodeJS.Timeout;
    res: Response;
    messageCount: number;
  }

  const sessions: Record<string, SessionInfo> = {};

  // Periodic session reaper
  setInterval(() => {
    const now = Date.now();
  for (const [id, info] of Object.entries(sessions)) {
      if (now - info.lastActivity > MAX_SESSION_AGE_MS) {
        try { info.res.end(); } catch {}
        clearInterval(info.keepAliveTimer); // eslint-disable-line @typescript-eslint/no-explicit-any
        delete sessions[id];
    log('info', 'Reaped idle session', { sessionId: id });
      }
    }
  }, Math.min(MAX_SESSION_AGE_MS / 2, 5 * 60 * 1000));

  app.get('/sse', async (req: Request, res: Response) => {
    // Optional auth token check
    if (REQUIRE_AUTH_TOKEN && req.headers['authorization'] !== `Bearer ${REQUIRE_AUTH_TOKEN}`) {
      res.status(401).end('Unauthorized');
      return;
    }
    // SSE headers (some added manually for reverse proxy friendliness; transport sets the basics)
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // SSEServerTransport auto-generates a sessionId; no custom option needed here.
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    sessions[sessionId] = {
      transport,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      res,
      messageCount: 0,
    };

    // Keep-alive pings (best-effort; ignore errors if closed)
    const keepAliveTimer = setInterval(() => {
      const info = sessions[sessionId];
      if (!info) { clearInterval(keepAliveTimer); return; }
      try {
        if ((res as any).writableEnded) { clearInterval(keepAliveTimer); return; }
        // Raw SSE ping event
        res.write(`event: ping\ndata: ${new Date().toISOString()}\n\n`);
      } catch {
        clearInterval(keepAliveTimer);
      }
    }, KEEPALIVE_INTERVAL_MS);
    sessions[sessionId].keepAliveTimer = keepAliveTimer;

    res.on('close', () => {
      clearInterval(keepAliveTimer);
      delete sessions[sessionId];
      log('info', 'Session closed', { sessionId });
    });

  const server = createMcpServer();
  await server.connect(transport);
  log('info', 'Session started', { sessionId });
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = (req.query.sessionId || req.query.session_id) as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' });
      return;
    }
    const session = sessions[sessionId];
    if (!session) {
      res.status(404).json({ error: 'Unknown sessionId' });
      return;
    }
    session.lastActivity = Date.now();
    const transport = session.transport;
    try {
      const start = LOG_TIMING ? performance.now() : 0;
      session.messageCount++;
      const method = (req.body && typeof req.body === 'object') ? (req.body.method || 'unknown') : 'unknown';
      if (shouldLog('debug')) {
        log('debug', 'Incoming message', { sessionId, messageCount: session.messageCount, method });
      }
      if (LOG_RPC_BODIES) {
        try {
          const preview = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          log('trace', 'RPC body', { sessionId, bodyPreview: preview.substring(0, 1000) });
          const rawBody = (req as any).rawBody;
          if (rawBody && rawBody.trim() !== preview.trim()) {
            log('trace', 'RPC rawBody differs', { sessionId, rawPreview: rawBody.substring(0, 1000) });
          }
        } catch {}
      }
      if (method === 'unknown' && shouldLog('warn')) {
        log('warn', 'Message without method field', { sessionId, hasBody: !!req.body, bodyType: typeof req.body });
      }
      if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 0) {
        log('warn', 'Rejecting empty JSON object (expected JSON-RPC initialize)', { sessionId });
        res.status(400).json({ error: 'Empty JSON object received; expected JSON-RPC initialize request.' });
        return;
      }
      await transport.handlePostMessage(req, res, req.body);
      if (LOG_TIMING) {
        const dur = performance.now() - start;
        log('trace', 'Message handled', { sessionId, ms: Math.round(dur) });
      }
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
      log('error', 'Message error', { sessionId, error: e?.message });
    }
  });

  // Simple health endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transport: 'sse',
      sessions: Object.keys(sessions).length,
      protocol: SUPPORTED_PROTOCOL_VERSION,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  await new Promise<void>((resolve) => {
    app.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log('info', 'Listening (SSE)', { url: `http://${LISTEN_HOST}:${LISTEN_PORT}/sse` });
      resolve();
    });
  });
}

async function startStreamableHttpServer() {
  const app = express();
  app.use(express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }));
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return cb(null, origin || true);
      return cb(new Error('Origin not allowed by CORS'));
    },
    allowedHeaders: ['Content-Type', 'mcp-session-id', 'Mcp-Session-Id', 'Authorization'],
    exposedHeaders: ['Mcp-Session-Id'],
  }));

  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const servers: Record<string, McpServer> = {};

  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionIdHeader = (req.headers['mcp-session-id'] as string | undefined) || undefined;
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionIdHeader && transports[sessionIdHeader]) {
        transport = transports[sessionIdHeader];
      } else {
        // New session -> create transport & server upon initialize request
        // Build an expanded allowed host list including host:port variants to avoid false negatives.
        const baseHosts = [LISTEN_HOST, '127.0.0.1', 'localhost'];
        const hostSet = new Set<string>();
        for (const h of baseHosts) {
          if (!h) continue;
            hostSet.add(h);
            hostSet.add(`${h}:${LISTEN_PORT}`);
        }
        const expandedAllowedHosts = Array.from(hostSet);
  transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId: string) => {
            transports[sessionId] = transport!;
          },
          enableDnsRebindingProtection: ENABLE_DNS_REBIND_PROTECTION,
          allowedHosts: expandedAllowedHosts,
        });
        log('debug', 'Stream transport allowedHosts', { allowedHosts: expandedAllowedHosts });
  log('info', 'Security mode', { dnsRebindingProtection: ENABLE_DNS_REBIND_PROTECTION, strictFlag: STRICT_SECURITY_FLAG });
        const server = createMcpServer();
        await server.connect(transport);
        servers[(transport as any).sessionId] = server;
      }
      const start = LOG_TIMING ? performance.now() : 0;
      const method = (req.body && typeof req.body === 'object') ? (req.body.method || 'unknown') : 'unknown';
      log('debug', 'HTTP stream request', { existing: !!transports[(transport as any).sessionId], method });
      if (LOG_RPC_BODIES) {
        try {
          const preview = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
          log('trace', 'HTTP RPC body', { bodyPreview: preview.substring(0, 1000) });
          const rawBody = (req as any).rawBody;
          if (rawBody && rawBody.trim() !== preview.trim()) {
            log('trace', 'HTTP rawBody differs', { rawPreview: rawBody.substring(0, 1000) });
          }
        } catch {}
      }
      if (method === 'unknown' && req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 0) {
        log('warn', 'Rejecting empty JSON object (expected JSON-RPC initialize)');
        res.status(400).json({ error: 'Empty JSON object received; expected JSON-RPC initialize request.' });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      if (LOG_TIMING) {
        const dur = performance.now() - start;
        log('trace', 'HTTP stream handled', { ms: Math.round(dur) });
      }
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
      log('error', 'HTTP stream error', { error: e?.message });
    }
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      transport: 'stream',
      sessions: Object.keys(transports).length,
      protocol: SUPPORTED_PROTOCOL_VERSION,
      uptimeSec: Math.round(process.uptime()),
    });
  });

  await new Promise<void>((resolve) => {
    app.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log('info', 'Listening (HTTP Stream)', { url: `http://${LISTEN_HOST}:${LISTEN_PORT}/mcp` });
      resolve();
    });
  });
}

async function main() {
  if (TRANSPORT === 'sse') {
    await startSseServer();
  } else {
    await startStreamableHttpServer();
  }
}

main().catch((error) => {
  log('error', 'Fatal error in main()', { error: error?.message, stack: error?.stack });
  process.exit(1);
});