# Phase 1: Core Persistence & Session Management

## 1. 목표

-   SQLite 기반 Canonical Store와 버전 Migration을 구축한다.
-   Migration 전 최소 안전 DB Snapshot을 Phase 1부터 적용한다.
-   Telegram Numeric User ID 기반 단일 OWNER 인증을 구현한다.
-   세션/메시지 영속화와 `/new`, `/sessions`, `/rename`,
    Archive/Delete/Restore를 구현한다.

## 2. 선행 조건

-   Phase 0 `DONE`.
-   `/data` 영속 경로 확보.

## 3. 세부 작업 항목

-   [x] **SQLite 초기화**
    -   DB: `/data/agent-hub.db` (`better-sqlite3`, WAL 모드, 외래키 활성화, busy timeout 설정).
-   [x] **Migration Engine**
    -   `schema_migrations` 기반 순차 Migration (`src/database/migrator.js`).
    -   Migration 적용 직전 안전 Snapshot 생성 (`src/database/pre-migration-backup.js`).
    -   Migration 실패 또는 DB 버전 초과 시 Startup Abort.
-   [x] **초기 Schema**
    -   `001_initial.sql`: `users`, `settings`, `sessions`, `messages`.
    -   Session: `ACTIVE`, `ARCHIVED`, `DELETED`, `deleted_at` 30일 Soft Delete 필드.
    -   `settings`에 `active_session_<userId>` 영속 저장.
-   [x] **Telegram OWNER Auth Middleware**
    -   `src/telegram/auth.js`: `TELEGRAM_ADMIN_USER_ID` 기반 단일 소유자 인증.
    -   비인가 사용자에게 인프라 정보 노출 차단 및 보안 로그 기록.
-   [x] **Session Manager**
    -   `src/sessions/session-manager.js`: `createSession`, `getActiveSession`, `setActiveSession`, `listSessions`, `renameSession`, `archiveSession`, `softDeleteSession`, `restoreSession`.
    -   `/new`: 즉시 세션 생성.
    -   `/sessions`: 활성/보관함/휴지통 탭 및 전환/보관/삭제/복구 인라인 UI.
    -   `/rename <새 제목>`: 세션 이름 변경 및 `title_locked = 1`.
-   [x] **Message Persistence**
    -   사용자 질문 및 Assistant 원문 출력을 Canonical SQLite `messages`에 영속화.
    -   Telegram 전송 시에만 길이 분할하고 DB에는 원문 1건 유지.

## 4. 생성 / 수정 대상 파일

-   `src/database/index.js`
-   `src/database/migrator.js`
-   `src/database/pre-migration-backup.js`
-   `src/database/migrations/001_initial.sql`
-   `src/telegram/auth.js`
-   `src/sessions/session-manager.js`
-   `src/telegram/commands/new.js`
-   `src/telegram/commands/sessions.js`
-   `src/telegram/commands/rename.js`
-   `package.json`

## 5. 테스트 / 검증 기준

-   [ ] Unit: Session create/switch/rename/archive/delete/restore.
-   [ ] Integration: Migration 순차 적용 및 재실행 idempotency.
-   [ ] Integration: Migration 실패 시 Startup Abort.
-   [ ] Integration: Migration 전 Snapshot 생성 확인.
-   [ ] Unauthorized Telegram Update 차단.
-   [ ] 컨테이너 재시작 후 Session/Message/Active Session 유지.
-   [ ] `/new → /rename → /sessions → delete → restore` 실제 동작.
-   [ ] 기존 Telegram → Codex 기본 질의 회귀 테스트 통과.
