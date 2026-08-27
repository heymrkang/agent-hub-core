FROM node:20-bookworm-slim

# 기본 도구 및 빌드 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
    curl \
    git \
    docker.io \
    openssh-client \
    tzdata \
    util-linux \
    gpg \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI는 Debian 기본 저장소의 오래된 버전 대신 공식 패키지 저장소에서 설치한다.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# 타임존 설정 (Asia/Seoul)
ENV TZ=Asia/Seoul
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Codex CLI 고정 버전 전역 설치
RUN npm install -g @openai/codex@0.149.1

# Antigravity CLI (agy) v1.1.20 고정 버전 설치 및 SHA512 무결성 검증
RUN curl -fsSL "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.1.20-5830032204103680/linux-x64/cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz \
    && echo "6cdc7fc90562ba40c8bf0658f30ede016e6acd03083779be8d54d4bf63dd99800393e33c00addf943f6c2b79b4dacefc6fb4a963b2b02f6ce63635ef54a42868  /tmp/agy.tar.gz" | sha512sum -c - \
    && tar -xzf /tmp/agy.tar.gz -C /usr/local/bin \
    && ln -snf /usr/local/bin/antigravity /usr/local/bin/agy \
    && chmod +x /usr/local/bin/antigravity /usr/local/bin/agy \
    && rm -rf /tmp/agy.tar.gz \
    && agy --version

# Phase 9 CLI 존재 여부를 build 단계에서 검증
RUN git --version && gh --version | head -n 1 && docker --version && ssh -V

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

# 영속 데이터 및 볼륨 마운트 표준 디렉토리 구조 생성
RUN mkdir -p /workspace/repos \
    /data/providers/codex \
    /data/providers/antigravity \
    /data/memory \
    /data/ssh/keys \
    /data/uploads \
    /data/logs \
    /data/backups/core \
    /data/backups/full \
    /data/backups/migrations \
    /root/.codex \
    /root/.gemini \
    /root/.ssh \
    && chmod 700 /data/ssh /data/ssh/keys /root/.ssh

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV WORKSPACE_DIR=/workspace
ENV REPOS_ROOT=/workspace/repos
ENV SSH_DATA_DIR=/data/ssh
ENV HEALTH_HOST=127.0.0.1
ENV HEALTH_PORT=8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
