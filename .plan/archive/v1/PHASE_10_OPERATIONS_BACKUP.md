# Phase 10: Operations, Backup, Notification & Observability

**Status: DONE**

## 1. 목표

-   `/usage`, `/status`, `/settings`, 내부 `/health`를 완성한다.
-   Daily Core Backup + 최근 7개 보존을 구현한다.
-   수동 Full Backup을 구현한다.
-   공통 Notification Manager를 구축한다.
-   30일 Cleanup/Log Rotation/System Job을 구현한다.

## 2. 선행 조건

-   Phase 1 \~ 9 주요 모듈 완료.

## 3. 세부 작업 항목

-   [x] **`/usage`**
    -   Provider가 실제 노출하는 quota/window만 표시.
    -   없는 수치 추정 금지.
    -   Agent Hub Job 통계: 실행 횟수/시간/provider/model distribution.
    -   실제 token count가 제공될 때만 저장/표시.
    -   High-usage automatic warning은 Backlog.
-   [x] **`/status`**
    -   App version.
    -   DB schema version.
    -   Core/DB/Scheduler.
    -   Codex/Gemini health/auth.
    -   Docker/SSH.
    -   Active Session/Provider/Model/Profile/Job.
    -   최근 중요 failure가 유용하면 요약.
-   [x] **Internal `/health`**
    -   Docker/Coolify healthcheck용 경량 HTTP endpoint.
    -   **Public Agent Hub API가 아님.**
    -   가능하면 외부 인터넷에 직접 공개하지 않고 내부 network/localhost
        또는 Coolify health path로 사용.
    -   SQLite/Core critical failure → unhealthy.
    -   개별 Provider/SSH 장애 → degraded일 수 있으나 Core health와
        분리.
    -   Docker HEALTHCHECK 연결.
-   [x] **`/settings`**
    -   Defaults: provider/model/profile.
    -   Context: auto compact threshold.
    -   Runtime: Codex/Gemini concurrency.
    -   User: timezone.
    -   Notifications.
    -   Session: automatic title.
    -   Telegram UI Style: `NORMAL` / `STEALTH`.
        - `NORMAL`: 기존 이모티콘/강조 UI 사용.
        - `STEALTH`: Telegram Bot **명령어/시스템 UI**의 컬러 이모티콘을 제거하고 흑백 기호(예: `●`, `○`, `■`, `>` 등)와 텍스트 중심으로 렌더링.
        - LLM이 생성한 일반 답변 내용은 Stealth가 임의 변조하지 않는다.
        - Inline button label도 동일 UI style을 적용한다.
    -   설정은 SQLite 영속화.
-   [x] **Core Backup**
    -   Daily once.
    -   Latest 7 retained.
    -   SQLite 안전 snapshot API 사용.
    -   Memory/settings/critical metadata 포함.
    -   SSH Private Keys 기본 제외.
    -   Logs 기본 제외.
-   [x] **Manual Full Backup**
    -   `/backup`에서 명시적으로 실행.
    -   Full의 정확한 포함 범위를 문서화.
    -   SSH Private Key는 기본 제외를 유지하며, 포함 기능은 별도 명시
        정책 없이는 자동 포함하지 않는다.
    -   Backup metadata SQLite 저장.
-   [x] **`/backup`**
    -   Run Core backup now.
    -   Run Full backup.
    -   List backups.
    -   Backup settings/status.
-   [x] **Notification Manager**
    -   Telegram only V1.
    -   Background session completion → notify.
    -   Scheduler completed/failed → notify.
    -   Backup success → silent.
    -   Cleanup success → silent.
    -   Backup/System Job/Auth/Core health failure → notify.
    -   설정 ON/OFF 적용.
-   [x] **Internal System Jobs**
    -   Daily Core Backup.
    -   30일 경과 Soft Deleted Session + 연결 upload 영구 삭제.
    -   30일 경과 Log cleanup/rotation.
    -   User Schedule과 구분.
-   [x] **Structured Logging**
    -   app/provider/scheduler/error category.
    -   timestamp/level/session/provider/model/event/duration/error
        code.
    -   Canonical Conversation 원문을 일반 log에 중복 저장하지 않는다.
    -   Secret redaction.

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/011_operations.sql`
-   `src/backup/backup-manager.js`
-   `src/notifications/notification-manager.js`
-   `src/health/health-server.js`
-   `src/logging/logger.js`
-   `src/system/system-jobs.js`
-   `src/telegram/commands/usage.js`
-   `src/telegram/commands/status.js`
-   `src/telegram/commands/settings.js`
-   `src/telegram/renderer/ui-theme.js`
-   `src/telegram/commands/backup.js`
-   `Dockerfile`

## 5. 테스트 / 검증 기준

-   [x] `/usage`에서 미제공 수치가 추정되지 않음.
-   [x] `/status` 주요 컴포넌트 상태 확인.
-   [x] 내부 `/health` 200/degraded/unhealthy 정책 검증.
-   [x] `/settings` Stealth ON/OFF가 SQLite에 영속되고 Telegram 명령 UI만 스타일 전환되며 LLM 일반 답변은 변경하지 않음.
-   [x] Core Backup 유효 SQLite snapshot.
-   [x] Daily backup retention 7.
-   [x] Manual Full Backup 생성.
-   [x] Backup에서 SSH private key 기본 제외.
-   [x] 30일 Session/Upload cleanup.
-   [x] 30일 Log cleanup.
-   [x] Secret이 log에 평문으로 남지 않음.
-   [x] Notification policy가 설정대로 동작.

## 6. 완료 메모

- Phase 10 operations schema는 실제 적용된 migration v11 기준으로 정리했다.
- `/usage`, `/status`, `/backup`, Core/Full backup, internal health endpoint 및 Coolify healthcheck를 실제 배포 환경에서 검증했다.
- Background session completion notification을 실제 세션 전환 중 실행 작업으로 검증했다.
- Full Backup의 SSH private key/log/기존 backup archive 제외, Core retention 7, 30일 cleanup 및 secret redaction은 최종 코드 감사로 확인했다.
