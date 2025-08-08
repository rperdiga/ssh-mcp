@echo off
REM Start a disposable Ubuntu 22.04 container with an SSH server for testing.
echo Starting Ubuntu container with SSH server...

REM Stop and remove existing container if it exists
docker stop simple-ssh 2>nul
docker rm simple-ssh 2>nul

echo Pulling and starting Ubuntu container...
docker run -d ^
  --name simple-ssh ^
  -p 2222:22 ^
  ubuntu:22.04 ^
  bash -c "apt-get update && apt-get install -y openssh-server && useradd -m -s /bin/bash computeruse && echo 'computeruse:computeruse' | chpasswd && echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config && echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config && service ssh start && tail -f /dev/null"

echo Container started. Waiting ~25s for SSH to become ready...
timeout /t 25 >nul

echo Testing SSH connectivity...
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o PasswordAuthentication=yes -p 2222 computeruse@127.0.0.1 "echo 'SSH connection successful'"

echo.
echo SSH container is running on port 2222
echo To connect: ssh -p 2222 computeruse@127.0.0.1
echo Password: computeruse
echo.
echo For MCP server use: --sshPort=2222 --host=127.0.0.1 --user=computeruse --password=computeruse
echo To stop the container: docker stop simple-ssh
