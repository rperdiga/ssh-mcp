@echo off
REM SSH MCP Server (SSE Transport) launcher
REM Usage:
REM   StartSSEMCP.bat            -> start with minimal logging (recommended)
REM   StartSSEMCP.bat verbose    -> start with verbose debug logging

set "VERBOSE=0"
if /I "%~1"=="verbose" set "VERBOSE=1"

REM Open a new window if not already elevated/child (helps when launched from tools)
if "%1" neq "ELEVATED" (
    start "SSH MCP Server (SSE)" cmd /k "%~f0" ELEVATED %~1
    exit /b
)

REM Set working directory to the batch file location
cd /d "%~dp0"

title SSH MCP Server (SSE Transport)
echo.
echo ============================================
echo  SSH MCP Server (SSE Transport)
echo ============================================
echo.
echo Current Directory: %CD%
echo.
echo Checking Node.js availability...
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found in PATH
    echo Please ensure Node.js is installed and in your PATH
    echo.
    goto :error_exit
)

echo Node.js found: 
node --version
echo.
echo Checking if build/index.js exists...
if not exist "build\index.js" (
    echo ERROR: build\index.js not found
    echo Please ensure the project is built
    echo Current directory: %CD%
    echo.
    goto :error_exit
)
echo Build file found: build\index.js
echo.
echo Starting server...
if "%VERBOSE%"=="1" (
    echo Verbose logging enabled (LOG_LEVEL=debug)
    set "LOG_LEVEL=debug"
) else (
    echo (Run with: StartSSEMCP.bat verbose  for debug logging)
)
echo Transport: SSE
echo Listen Port: 3001
echo Host: localhost
echo SSH Port: 2222
echo User: computeruse
echo Timeout: 30000ms
echo.

node build/index.js --transport=sse --listenPort=3001 --host=localhost --sshPort=2222 --user=computeruse --password=computeruse --timeout=30000

echo.
echo ============================================
if errorlevel 1 (
    echo ERROR: Server exited with error code %errorlevel%
) else (
    echo Server stopped normally
)
echo ============================================
goto :normal_exit

:error_exit
echo ============================================
echo SETUP ERROR - Please check the above messages
echo ============================================

:normal_exit
echo.
echo Press any key to close this window...
pause >nul