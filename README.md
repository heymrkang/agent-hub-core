# docker-agent-telegram

Docker 기반 Codex / LLM CLI 연동 Telegram Agent (Phase 1)

## 1. 개요
Telegram 메시지를 수신하여 로컬 컨테이너에 설치된 Codex CLI를 실행하고 결과를 Telegram으로 반환하는 경량 에이전트 서비스입니다.

## 2. 환경 설정
`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 값을 채웁니다.

```bash
cp .env.example .env
```

- `TELEGRAM_BOT_TOKEN`: @BotFather 에게서 발급받은 봇 토큰
- `TELEGRAM_ALLOWED_USER_IDS`: 허용할 본인 텔레그램 숫자 ID (쉼표로 여러 명 지정 가능)

## 3. 실행 및 Codex 로그인 방법

### 1) Docker 이미지 빌드 및 실행
```bash
docker compose up -d --build
```

### 2) Codex CLI 1회 로그인 인증
컨테이너 내부로 접속하여 Codex 로그인을 진행합니다. (인증 데이터는 `codex_auth` 볼륨에 영속화됩니다)

```bash
docker compose exec agent-telegram codex login
```
화면에 출력되는 URL로 접속하여 로그인 승인을 완료합니다.

### 3) 로그 확인
```bash
docker compose logs -f
```

## 4. Phase 1 테스트 절차
1. 텔레그램 봇 대화방에서 `/start` 입력하여 연결 확인
2. 텔레그램에 `안녕` 또는 `현재 디렉토리 파일 목록 알려줘` 메시지 전송
3. Codex CLI 실행 후 텔레그램으로 응답이 정상 반환되는지 확인
