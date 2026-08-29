# Phase 3: Job Runtime, Queue Concurrency & Response Rendering

## 1. 목표

-   모든 CLI 실행을 공통 Job Runtime으로 통합한다.
-   Session FIFO Queue와 Provider Concurrency Queue를 구현한다.
-   `/queue`, `/stop`, Job 상태 UI를 구현한다.
-   Telegram 제약과 Canonical Response 저장을 분리하는 Response
    Renderer를 구현한다.

## 2. 선행 조건

-   Phase 2 `DONE`.

## 3. 세부 작업 항목

-   [x] **Job State Machine**
    -   `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `INTERRUPTED`.
    -   `002_jobs.sql` 마이그레이션 적용 및 `src/jobs/types.js`에 상태/에러 상수 정의.
-   [x] **Session Queue**
    -   `src/jobs/queue-manager.js`: 동일 세션 내 동시 요청 시 FIFO 순서 보장.
-   [x] **Provider Queue**
    -   프로바이더별 동시 실행 슬롯 제한 (Codex 2, Gemini 2).
    -   슬롯 초과 시 Provider Queue에서 대기 후 슬롯 반환 시 자동 실행.
-   [x] **Job Runtime**
    -   `src/jobs/job-runtime.js`: DB `jobs` 영속 관리.
    -   `AbortController` 기반 취소 및 `/stop` 연동.
-   [x] **Restart Recovery**
    -   앱 기동 시 `RUNNING` 상태의 잔여 Job을 `INTERRUPTED` (reason: `AGENT_HUB_RESTART`)로 일괄 전환. 자동 재실행 배제.
-   [x] **Telegram Job Status**
    -   `src/telegram/renderer/job-status.js`: `QUEUED` -> `RUNNING` -> `COMPLETED`/`FAILED`/`CANCELLED` 실시간 상태 메시지 갱신.
    -   인라인 취소 버튼 (`/stop`) 제공.
-   [x] **Response Renderer**
    -   `src/telegram/renderer/response-renderer.js`: DB에는 원문 1건 저장, Telegram 전송 시 코드 블록(```) 보존 안전 분할.
-   [x] **Error Taxonomy 기반**
    -   에러 범주별 분류 (`TIMEOUT`, `CANCELLED`, `PROVIDER_EXEC`, `AGENT_HUB_RESTART` 등).

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/002_jobs.sql`
-   `src/jobs/types.js`
-   `src/jobs/job-runtime.js`
-   `src/jobs/queue-manager.js`
-   `src/telegram/commands/stop.js`
-   `src/telegram/commands/queue.js`
-   `src/telegram/renderer/job-status.js`
-   `src/telegram/renderer/response-renderer.js`

## 5. 테스트 / 검증 기준

-   [ ] Unit: Job state transition.
-   [ ] Unit: Response Renderer 긴 응답/Markdown/Code block.
-   [ ] Integration: 동일 Session FIFO.
-   [ ] Integration: Provider concurrency 초과 대기.
-   [ ] Integration: `/stop` 시 Child Process 종료 + `CANCELLED`.
-   [ ] Restart 후 이전 Running Job `INTERRUPTED`.
-   [ ] 긴 Assistant Response가 DB에는 원문 1건, Telegram에는 안전 분할.
