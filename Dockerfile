FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 ca-certificates curl git docker.io openssh-client tzdata util-linux gpg \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh && rm -rf /var/lib/apt/lists/*

RUN mkdir -p -m 755 /usr/share/keyrings \
    && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list \
    && apt-get update && apt-get install -y --no-install-recommends cloudflared \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Seoul
ENV AGY_CLI_DISABLE_AUTO_UPDATE=1
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
RUN npm install -g @openai/codex@0.164.0
RUN curl -fsSL "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.4.6-4884751325200384/linux-x64/cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz \
    && echo "4e1244b8b8c1280552f59c1b24b76a9245db9c80032aec6db28fb86033d6088abc30a90dad432d2b246c28fdd87d82abb48727d5ff88ba1d5d4ec76b33348e7d  /tmp/agy.tar.gz" | sha512sum -c - \
    && tar -xzf /tmp/agy.tar.gz -C /usr/local/bin && ln -snf /usr/local/bin/antigravity /usr/local/bin/agy \
    && chmod +x /usr/local/bin/antigravity /usr/local/bin/agy && rm -rf /tmp/agy.tar.gz && agy --version
RUN git --version && gh --version | head -n 1 && docker --version && ssh -V && cloudflared --version

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src/ ./src/

# /home/dev is the persistent user development root. The host directory may still be named "dev".
# /home/dev/workspace is the conventional Git project area; notes, ideas and other user-authored
# development material may live anywhere under /home/dev. Agent Hub state and SSH keys stay in /data.
RUN mkdir -p /home/dev/workspace \
    /data/providers/codex /data/providers/antigravity /data/memory /data/ssh/keys /data/uploads \
    /data/logs /data/backups/core /data/backups/full /data/backups/migrations \
    /root/.codex /root/.gemini /root/.ssh \
    && chmod 700 /data/ssh /data/ssh/keys /root/.ssh

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV WORKSPACE_DIR=/home/dev
ENV REPOS_ROOT=/home/dev/workspace
ENV SSH_DATA_DIR=/data/ssh
ENV HEALTH_HOST=127.0.0.1
ENV HEALTH_PORT=8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
