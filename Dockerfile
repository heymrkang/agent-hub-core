FROM node:20-bookworm-slim

# 기본 도구 및 빌드 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    ca-certificates \
    curl \
    git \
    openssh-client \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# 타임존 설정 (Asia/Seoul)
ENV TZ=Asia/Seoul
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Codex CLI 고정 버전 전역 설치
RUN npm install -g @openai/codex@0.149.1

# 작업 디렉토리 설정
WORKDIR /app

# Node 의존성 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 소스코드 복사
COPY src/ ./src/

# 영속 데이터 및 볼륨 마운트 표준 디렉토리 구조 생성
RUN mkdir -p /workspace \
    /data/agent-hub.db \
    /data/providers/codex \
    /data/providers/gemini \
    /data/memory \
    /data/ssh/keys \
    /data/uploads \
    /data/logs \
    /data/backups/core \
    /data/backups/full \
    /data/backups/migrations \
    /root/.codex

ENV NODE_ENV=production
ENV DATA_DIR=/data

CMD ["node", "src/index.js"]
