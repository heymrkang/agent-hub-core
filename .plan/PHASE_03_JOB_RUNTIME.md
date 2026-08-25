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

-   [ ] **Job State Machine**
    -   `QUEUED`
    -   `RUNNING`
    -   `COMPLETED`
    -   `FAILED`
    -   `CANCELLED`
    -   `INTERRUPTED`
    -   `jobs` Migration 추가.
    -   Provider/Model/Session/Timing/Exit Code/Error Category 저장.
-   [ ] **Session Queue**
    -   동일 Session 요청 FIFO.
    -   Session 내부 순서 보장.
-   [ ] **Provider Queue**
    -   Provider별 concurrency limit.
    -   초기 기본값 Codex 2 / Gemini 2.
    -   Phase 10 `/settings`에서 변경 가능하도록 설정 키 준비.
    -   무제한 process 폭증 방지.
-   [ ] **Job Runtime**
    -   Child Process spawn.
    -   stdout/stderr 분리.
    -   timeout/cancellation 기반 구조.
    -   `/stop`은 Active Session의 Running Job에 적용.
    -   다른 Session Job은 `/sessions` UI에서 취소 가능하도록 hook 제공.
-   [ ] **Restart Recovery**
    -   Startup 시 남은 `RUNNING` Job → `INTERRUPTED`.
    -   reason `AGENT_HUB_RESTART`.
    -   자동 재실행 금지.
-   [ ] **Telegram Job Status**
    -   `QUEUED → RUNNING → terminal state`.
    -   Provider/Model/Elapsed/Queue position.
    -   Stop button.
    -   Background Session 완료 시 Source Session 식별.
-   [ ] **Response Renderer**
    -   Provider Assistant 원문은 DB에 **한 메시지**로 저장.
    -   Telegram 전송 시에만 길이 제한에 맞게 안전 분할.
    -   Markdown escape/format 오류 방어.
    -   Code block을 가능한 한 보존.
    -   Telegram 여러 메시지로 나뉘어도 Canonical DB Message를 쪼개지
        않는다.
-   [ ] **Error Taxonomy 기반**
    -   Provider/Auth/Network/Timeout/Cancelled/Internal 등 최소 분류
        구조.

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
