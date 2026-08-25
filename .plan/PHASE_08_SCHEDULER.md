# Phase 8: Internal Scheduler Engine

## 1. 목표

-   OS Cron 없이 Agent Hub 자체 Scheduler를 구축한다.
-   User Schedule과 Internal System Job을 SQLite 기반으로 관리한다.
-   자연어 → 구조화 Intent → 검증 → Telegram 확인 → 등록 흐름을
    구현한다.
-   Scheduler 실행 결과를 디버깅 가능한 수준으로 **전체 보존**한다.

## 2. 선행 조건

-   Phase 3 `DONE`.
-   Phase 7 `DONE`.

## 3. 세부 작업 항목

-   [ ] **Scheduler Schema**
    -   `schedules`.
    -   `schedule_runs`.
    -   Provider/Model/Profile/Timezone/Timeout/Enabled/Overlap/Next
        Run.
    -   User schedule과 System schedule/job 구분 가능.
-   [ ] **Schedule Run Result**
    -   `output_summary`만으로 끝내지 않는다.
    -   전체 실행 결과는 `output_text` 또는 Canonical Job/Message 참조를
        통해 보존.
    -   stdout/stderr/error metadata와 구분.
    -   Secret redaction 적용.
-   [ ] **Scheduler Engine**
    -   OS Cron 금지.
    -   Cron expression parser 또는 동등한 내부 scheduling library.
    -   Agent Hub Process가 schedule definition을 DB에서 로드.
    -   isolated temporary execution context.
    -   실행은 Phase 3 Job Runtime에 위임.
-   [ ] **Overlap**
    -   V1 `SKIP`.
    -   이전 동일 Schedule이 Running이면 `SKIPPED`.
-   [ ] **Retry**
    -   V1 Automatic Retry 없음.
    -   Telegram Manual Retry action은 가능.
-   [ ] **Timeout**
    -   Schedule별 timeout.
    -   Timeout 시 Job 안전 취소 및 기록.
-   [ ] **Missed Runs**
    -   다운타임 중 놓친 실행 자동 Replay 금지.
    -   신뢰 가능하게 판단 가능한 경우 `MISSED` 기록.
-   [ ] **Provider Queue Grace**
    -   Provider slot을 일정 grace period 내 얻지 못하면 Scheduler Run
        `SKIPPED` 가능.
    -   값은 설정 가능하도록 구조화.
-   [ ] **Natural Language Registration**
    -   현재 Provider가 Schedule Intent를 구조화 JSON으로 추출.
    -   Agent Hub가 Timezone/date/provider/model/profile/prompt/timeout
        검증.
    -   모호한 시간은 추측하지 않고 clarification.
    -   Telegram confirmation UI.
    -   사용자 명시 승인 후 DB Insert.
    -   Intent 해석 Provider와 실제 실행 Provider는 다를 수 있음.
-   [ ] **`/schedule`**
    -   목록.
    -   생성.
    -   수정.
    -   enable/disable.
    -   최근 실행 이력.
    -   실행 결과 확인.

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/006_scheduler.sql`
-   `src/scheduler/engine.js`
-   `src/scheduler/intent.js`
-   `src/scheduler/types.js`
-   `src/telegram/commands/schedule.js`
-   `src/telegram/handlers/schedule-confirmation.js`

## 5. 테스트 / 검증 기준

-   [ ] Unit: Cron/timezone next-run 계산.
-   [ ] Unit: Intent validation.
-   [ ] Integration: 자연어 → 확인 → 승인 → DB 등록.
-   [ ] Integration: Active Session 방해 없이 isolated execution.
-   [ ] Overlap `SKIP`.
-   [ ] Timeout.
-   [ ] Automatic Retry가 발생하지 않음.
-   [ ] Missed run 자동 Replay 없음.
-   [ ] Scheduler 실행 **전체 결과**를 이후 조회 가능.
-   [ ] Provider Queue 포화 시 정책대로 처리.
