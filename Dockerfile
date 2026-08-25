FROM node:20-bookworm-slim

# 기본 도구 및 시스템 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openssh-client \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# 타임존 설정 (Asia/Seoul)
ENV TZ=Asia/Seoul
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Codex CLI 전역 설치
RUN npm install -g @openai/codex

# 작업 디렉토리 설정
WORKDIR /app

# Node 의존성 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 소스코드 복사
COPY src/ ./src/

# 볼륨 마운트 대상 디렉토리 생성
RUN mkdir -p /workspace /data /root/.codex

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
