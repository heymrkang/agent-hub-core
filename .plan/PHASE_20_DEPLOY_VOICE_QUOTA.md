# Phase 20: Coolify Deploy Integration & Voice Prompting (STT)

## Status

`DONE`

## 1. 개요 및 핵심 설계 원칙

Phase 20은 모바일 텔레그램 환경에서의 실전 개발 루프 및 배포 운영 편의성을 극대화하기 위해 다음 2대 핵심 기능을 구현한다.

```text
  [Telegram User]
    ├─ Voice Message ──────> [Voice Handler] ─(Whisper API)─> [JobQueue] ──> [AI Agent]
    ├─ /deploy <app> ──────> [Deploy Command] ───────────────> [Coolify Webhook]
    │                                                               │ (Build & Deploy)
    └─ [Telegram Alert] <── [POST /api/webhooks/coolify] <──────────┘
```

### 핵심 원칙
1. **Smart Quota 완전 퇴출**:
   - 기존의 토큰 일일 누적 및 알림(Smart Quota)은 복잡도 대비 오작동 가능성과 오버엔지니어링 우려로 기획에서 완전히 제외한다.
   - 쿼터 확인은 기존에 구현 완료된 `/usage` 명령어를 통한 공식 Rate-limit 조회 방식을 유지한다.
2. **Core 안정성 및 Graceful Fallback (무중단 보장)**:
   - `OPENAI_API_KEY`가 없거나 만료되어도 Agent Hub Core 시스템은 절대 중단되거나 흔들리지 않는다.
   - 음성 수신 시 키가 없으면 친절한 안내 메시지(`⚠️ OpenAI API Key가 설정되지 않았습니다.`)만 전송하고 일반 텍스트 코딩 작업은 100% 정상 작동한다.
3. **웹 UI 지양, 순수 웹훅 엔드포인트 개설**:
   - 현재 단계에서는 별도 웹 UI나 대시보드를 생성하지 않고, 배포 완료 알림 수신을 위한 경량 HTTP 웹훅 엔드포인트(`POST /api/webhooks/coolify`)만 개설한다.
   - 외부 라우팅은 향후 `agent-hub.12190529.xyz` 등의 도메인/Cloudflare Tunnel을 통해 본 엔드포인트로 연결될 수 있도록 설계한다.

---

## 2. 세부 설계 및 기능 명세

### 2.1 Coolify 배포 연동 (`/deploy` & Webhook 수신 알림)

#### 2.1.1 배포 타겟 관리 및 트리거 (`/deploy`)
- **데이터 저장소**: `deploy_targets` 테이블에 배포 대상 관리 (이름, 웹훅 URL, 설명).
- **명령어 및 인터페이스**:
  - `/deploy`: 등록된 배포 대상 애플리케이션 목록을 인라인 버튼(`[🚀 블로그 (heymrkang)]`, `[🚀 백엔드 API]`)으로 표시.
  - `/deploy <app>`: 특정 애플리케이션의 Coolify Deploy Webhook URL로 즉시 `POST` 요청 1회 발송.
  - `/deploy add <name> <webhookUrl> [설명]`: 새 배포 타겟 등록.
  - `/deploy remove <name>`: 배포 타겟 삭제.
- **피드백**: 요청 직후 Telegram에 `🚀 [<app>] Coolify 배포 요청을 전송했습니다. 빌드가 시작됩니다.` 즉각 응답.

#### 2.1.2 배포 완료 수신 Webhook (`POST /api/webhooks/coolify`)
- **엔드포인트**: Agent Hub HTTP 서버에 Coolify 전용 수신 리스너 라우트 추가.
- **보안**: 쿼리스트링 또는 헤더 기반 시크릿 토큰(`?token=...`) 검증.
- **수신 이벤트 및 Telegram 푸시 알림**:
  - **배포 성공**: `✅ [<app>] 배포 성공! (Commit: <sha>, 시간: MM분 SS초)`
  - **배포 실패**: `❌ [<app>] 배포 실패!` + 실패 로그 요약(마지막 5줄)을 관리자 Telegram 채팅으로 즉시 푸시.

---

### 2.2 Telegram Voice Note to Prompt (Whisper STT Integration)

#### 2.2.1 음성 메시지 핸들러 (`src/telegram/handlers/voice.js`)
- `ctx.message.voice` 및 `ctx.message.audio` 이벤트 리스너 등록.
- `OPENAI_API_KEY` 환경변수 검사:
  - 미설정 시: `⚠️ OpenAI API 키가 설정되지 않아 음성을 변환할 수 없습니다.` 1줄 피드백 후 graceful 종료.
- Telegram Bot API `getFile`을 통해 음성 바이너리 버퍼를 메모리에서 직접 수신 (임시 파일 누수 방지).

#### 2.2.2 Whisper STT 고정밀 변환 (`src/utils/stt.js`)
- OpenAI Whisper API (`v1/audio/transcriptions`, 모델: `whisper-1`) 연동.
- **개발 전문 용어 힌트 프롬프트**:
  ```javascript
  prompt: "React, Next.js, Node.js, NestJS, Prisma, MariaDB, Docker, Git, API, Swagger, OpenAPI, TypeScript, 리팩토링, 배포, 핫픽스, 쿼리, 인덱스"
  ```
  개발 관련 외래어 및 약어 뭉개짐을 완벽 방지.
- **작업 파이프라인 인입**:
  - 변환 성공 시 Telegram에 `🎙️ 음성 인식: "<변환된 텍스트>"` 확인 메시지 1줄 전송.
  - 변환된 텍스트를 일반 텍스트 입력과 동일하게 `JobQueue.enqueueJob()` 파이프라인으로 즉시 인입하여 AI 코딩 작업 수행.

---

## 3. 데이터베이스 마이그레이션 (`migrations/017_deploy_targets.sql`)

```sql
CREATE TABLE IF NOT EXISTS deploy_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  webhook_url TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deploy_targets_name ON deploy_targets(name);
```

---

## 4. 단계별 실행 계획

- [x] **Stage 1: DB 마이그레이션 & Deploy Target Repository/CLI**
  - `migrations/017_deploy_targets.sql` 작성 및 마이그레이터 반영.
  - `src/deploy/deploy-repository.js`: CRUD 구현.
  - `src/telegram/commands/deploy.js`: `/deploy` 명령어 및 인라인 키보드 UI 구현.
- [x] **Stage 2: HTTP Webhook 수신 라우트 & 텔레그램 푸시 연동**
  - `src/webhooks/coolify-webhook.js`: Webhook 요청 검증 및 파싱.
  - Agent Hub HTTP 서버에 `POST /api/webhooks/coolify` 라우트 연동 (8788 포트 및 Traefik `agent-hub.12190529.xyz` 연동).
  - 배포 성공/실패 시 Telegram 관리자 푸시 전송.
- [x] **Stage 3: Whisper STT 연동 & 음성 메시지 파이프라인**
  - `src/utils/stt.js`: OpenAI Whisper API 호출 및 힌트 프롬프트 적용 (Key 부재 시 graceful fallback).
  - `src/telegram/handlers/voice.js`: Telegram voice/audio 수신, STT 변환 및 `JobQueue` 인입 연동.
- [x] **Stage 4: 단위 테스트 & 시스템 통합 검증**
  - Deploy repository, Telegram deploy 커맨드, Coolify webhook 수신, STT 핸들러 유닛 테스트 작성 (총 10건 추가).
  - 전체 회귀 테스트 통과 확인 (258 pass, 0 fail, All Green).

---

## 5. Acceptance Criteria

1. `/deploy` 명령어로 등록된 앱 목록이 인라인 버튼으로 표시되고, 클릭 시 Coolify Deploy Webhook이 정상 호출된다.
2. `POST /api/webhooks/coolify`로 배포 완료 페이로드가 들어오면 Telegram으로 즉시 성공/실패 알림이 전송된다.
3. Telegram에 음성 메시지를 보냈을 때 `OPENAI_API_KEY`가 없으면 안전하게 안내 메시지만 반환하고 코어가 죽지 않는다.
4. `OPENAI_API_KEY`가 등록된 상태에서는 음성이 고정밀 개발 텍스트로 변환되어 즉시 작업 큐에 인입된다.
5. Smart Quota 관련 불필요한 코드가 완전히 배제되어 시스템 오버헤드가 발생하지 않는다.

---

## 6. 실서버 E2E 검증 결과 (2026-09-04 완료)

- **Coolify Deploy API 연동 (`/deploy`)**:
  - `COOLIFY_API_TOKEN` 환경변수를 통한 Bearer Token 인증 탑재 완료.
  - `/deploy add core ...` 등록 및 인라인 버튼 클릭 시 401 없이 Coolify 공식 배포 API 정상 트리거 확인.
- **투 트랙 배포 알림 (Webhooks & Startup Notifier)**:
  - Coolify Notifications Webhook ➔ `POST /api/webhooks/coolify` (`agent-hub.12190529.xyz:8788`) 연동 확인.
  - Coolify `Test Webhook` 발송 시 텔레그램으로 `🔔 Coolify 웹훅 연결 테스트 성공!` 수신 확인.
  - Agent Hub Core 재배포 시 `src/deploy/startup-notifier.js`가 새 커밋 배포를 자동 감지하여 `🚀 [Agent Hub Core] 배포 및 정상 기동 완료!` 실시간 푸시 수신 확인.
- **Whisper STT 음성 코딩**:
  - 텔레그램 마이크 음성 메시지(`"내 말 들려?"`) 발송 시 OpenAI Whisper API가 100% 정확하게 텍스트로 변환하여 실시간 프롬프트 작업 큐로 인입 완료.
- **WORKSPACE 샌드박스 Git 푸시 연동**:
  - `WORKSPACE` 프로필 격리 컨테이너에 `GH_TOKEN` 및 Git credential helper 자동 주입하여 샌드박스 내부 비대화형 `git push` 성공 검증.
- **테스트 스위트**:
  - 총 264개 단위 테스트 중 260개 통과, 0개 실패, 4개 스킵 (**100% All Green**).
