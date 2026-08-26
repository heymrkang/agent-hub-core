# Phase 8: Internal Scheduler Engine

## 1. 목표

- OS Cron 없이 Agent Hub 자체 Scheduler를 구축한다.
- User Schedule과 Internal System Job을 SQLite 기반으로 관리한다.
- 자연어 → 구조화 Intent → 검증 → Telegram 확인 → 등록 흐름을 구현한다.
- Scheduler 실행 결과를 디버깅 가능한 수준으로 **전체 보존**한다.
- Provider 모델 목록을 백그라운드에서 미리 조회하여 SQLite에 캐시하고, `/model` UI가 CLI 실시간 조회 없이 즉시 응답하도록 한다.

## 2. 선행 조건

- Phase 3 `DONE`.
- Phase 7 `DONE`.
- Codex/Antigravity의 모델 Discovery는 ProviderAdapter를 통해 동적으로 수행하며 모델명을 Agent Hub 코드에 하드코딩하지 않는다.

## 3. 세부 작업 항목

- [ ] **Scheduler Schema**
  - `schedules`.
  - `schedule_runs`.
  - Provider/Model/Profile/Timezone/Timeout/Enabled/Overlap/Next Run.
  - User schedule과 System schedule/job 구분 가능.

- [ ] **Schedule Run Result**
  - `output_summary`만으로 끝내지 않는다.
  - 전체 실행 결과는 `output_text` 또는 Canonical Job/Message 참조를 통해 보존.
  - stdout/stderr/error metadata와 구분.
  - Secret redaction 적용.

- [ ] **Scheduler Engine**
  - OS Cron 금지.
  - Cron expression parser 또는 동등한 내부 scheduling library.
  - Agent Hub Process가 schedule definition을 DB에서 로드.
  - isolated temporary execution context.
  - 실행은 Phase 3 Job Runtime에 위임.

- [ ] **Internal System Job: Provider Model Catalog Refresh**
  - Codex와 Antigravity의 실제 CLI/Provider Discovery 결과를 주기적으로 백그라운드 조회한다.
  - 기본 Refresh 주기는 **6시간**으로 시작하며 추후 `/settings`에서 조정 가능하도록 구조화한다.
  - 모델명을 코드에 하드코딩하지 않는다.
  - Discovery 성공 결과를 SQLite Model Catalog Cache에 저장한다.
  - `/model → Provider` 진입 시 CLI를 새로 실행하지 않고 **SQLite Cache를 즉시 조회**하여 Telegram UI를 렌더링한다.
  - 서버 Startup을 Model Discovery 완료까지 Block하지 않는다. 기존 Cache가 있으면 즉시 사용하고 Refresh는 Background에서 수행한다.
  - 최초 설치 등 Cache가 비어 있으면 `/model`에서 `아직 모델 목록을 가져오지 못했습니다` 상태와 수동 Refresh action을 제공한다.
  - User Schedule과 동일한 Scheduler Engine을 사용하되 `SYSTEM` Job으로 명확히 구분한다.
  - Model Refresh 실패 자체는 Core/Scheduler 전체 장애로 취급하지 않는다.

- [ ] **Model Catalog Cache Schema**
  - `provider_models`
    - `provider`
    - `model_id`
    - `display_name`
    - `is_default`
    - `metadata_json`
    - `discovered_at`
    - Provider + model_id unique key.
  - `provider_model_cache`
    - `provider`
    - `status` (`FRESH`, `STALE`, `EMPTY` 등)
    - `last_attempt_at`
    - `last_success_at`
    - `last_error`
  - Provider가 반환하는 추가 모델 metadata는 가능한 범위에서 `metadata_json`에 보존한다.
  - Secret/credential은 Model Cache에 저장하지 않는다.

- [ ] **Stale-While-Revalidate 정책**
  - Refresh 성공 시 해당 Provider Catalog를 원자적으로 새 결과로 교체하고 `FRESH` 처리한다.
  - Refresh 실패 시 **기존 성공 Cache를 절대 삭제하지 않는다.**
  - 기존 Cache가 있으면 `STALE`로 표시하고 계속 `/model`에서 사용한다.
  - `last_attempt_at`, `last_success_at`, 안전하게 정리된 `last_error`를 기록한다.
  - 부분 파싱/비정상 결과로 기존 정상 Catalog를 덮어쓰지 않는다.
  - Discovery 결과가 정상적으로 빈 목록인지 Discovery 자체 실패인지 구분한다.

- [ ] **`/model` Cache UX**
  - Provider 선택 시 Cache만 읽어 모델 목록을 즉시 표시한다.
  - 화면에 마지막 성공 갱신 시각 또는 Cache age를 표시할 수 있다.
  - `FRESH`/`STALE` 상태를 사용자에게 과도하지 않게 표시한다.
  - `🔄 모델 목록 새로고침` 버튼을 제공한다.
  - 수동 Refresh 요청 시 Telegram Callback에 즉시 응답하고 Loading 상태를 먼저 표시한다.
  - 실제 Discovery는 Background/System Job으로 실행하고 성공 후 화면을 다시 렌더링한다.
  - Refresh 실패 시 기존 Cache가 있으면 기존 목록을 유지하면서 실패 사실만 알린다.
  - Cache가 전혀 없고 Refresh도 실패하면 명확한 오류와 `다시 시도` action을 제공한다.

- [ ] **Model Catalog Consistency**
  - 현재 Session의 `active_model`이 새 Catalog에서 사라져도 Session 값을 임의로 자동 변경하지 않는다.
  - 사용자가 다음 모델 변경을 시도할 때 현재 Provider Catalog와 실제 CLI 결과를 기준으로 검증한다.
  - Provider가 모델 목록 Discovery를 지원하지 않으면 가짜 목록을 만들지 않고 `UNSUPPORTED` 상태를 유지한다.
  - 동일 Provider 내 Model Refresh가 진행 중이면 중복 Refresh를 합치거나 `SKIP`하여 CLI 프로세스 폭증을 방지한다.

- [ ] **Overlap**
  - V1 `SKIP`.
  - 이전 동일 Schedule이 Running이면 `SKIPPED`.

- [ ] **Retry**
  - V1 Automatic Retry 없음.
  - Telegram Manual Retry action은 가능.
  - Model Catalog 정기 Refresh도 실패 즉시 자동 Retry하지 않고 다음 주기 또는 사용자 수동 Refresh를 기다린다.

- [ ] **Timeout**
  - Schedule별 timeout.
  - Timeout 시 Job 안전 취소 및 기록.
  - Model Discovery System Job에도 별도 timeout을 적용하여 CLI hang이 Scheduler를 점유하지 않도록 한다.

- [ ] **Missed Runs**
  - 다운타임 중 놓친 실행 자동 Replay 금지.
  - 신뢰 가능하게 판단 가능한 경우 `MISSED` 기록.
  - Model Catalog Refresh는 재기동 시 Cache age를 확인하여 필요하면 Background Refresh 1회를 예약할 수 있으나 Startup을 Block하지 않는다.

- [ ] **Provider Queue Grace**
  - Provider slot을 일정 grace period 내 얻지 못하면 Scheduler Run `SKIPPED` 가능.
  - 값은 설정 가능하도록 구조화.

- [ ] **Natural Language Registration**
  - 현재 Provider가 Schedule Intent를 구조화 JSON으로 추출.
  - Agent Hub가 Timezone/date/provider/model/profile/prompt/timeout 검증.
  - 모호한 시간은 추측하지 않고 clarification.
  - Telegram confirmation UI.
  - 사용자 명시 승인 후 DB Insert.
  - Intent 해석 Provider와 실제 실행 Provider는 다를 수 있음.

- [ ] **`/schedule`**
  - 목록.
  - 생성.
  - 수정.
  - enable/disable.
  - 최근 실행 이력.
  - 실행 결과 확인.

## 4. 생성 / 수정 대상 파일

- `src/database/migrations/006_scheduler.sql`
- `src/database/migrations/007_provider_model_cache.sql` 또는 Phase 8 migration numbering에 맞는 통합 migration
- `src/scheduler/engine.js`
- `src/scheduler/intent.js`
- `src/scheduler/types.js`
- `src/scheduler/system-jobs/model-catalog-refresh.js`
- `src/providers/model-catalog.js`
- `src/telegram/commands/model.js`
- `src/telegram/commands/schedule.js`
- `src/telegram/handlers/schedule-confirmation.js`

## 5. 테스트 / 검증 기준

- [ ] Unit: Cron/timezone next-run 계산.
- [ ] Unit: Intent validation.
- [ ] Integration: 자연어 → 확인 → 승인 → DB 등록.
- [ ] Integration: Active Session 방해 없이 isolated execution.
- [ ] Overlap `SKIP`.
- [ ] Timeout.
- [ ] Automatic Retry가 발생하지 않음.
- [ ] Missed run 자동 Replay 없음.
- [ ] Scheduler 실행 **전체 결과**를 이후 조회 가능.
- [ ] Provider Queue 포화 시 정책대로 처리.
- [ ] 최초 Model Discovery 성공 후 Codex/Antigravity Catalog가 SQLite에 저장됨.
- [ ] `/model → Codex/Antigravity`가 실시간 CLI Discovery 없이 Cache만으로 즉시 렌더링됨.
- [ ] Model Refresh 실패 후 기존 Catalog가 삭제되지 않고 `STALE` 상태로 계속 사용됨.
- [ ] Refresh 성공 시 Catalog가 원자적으로 갱신되고 `last_success_at`이 변경됨.
- [ ] Cache가 없는 최초 상태에서 명확한 Empty UI + 수동 Refresh action이 표시됨.
- [ ] `🔄 모델 목록 새로고침` 사용 시 Telegram Callback이 즉시 응답하고 Background Refresh 후 화면이 갱신됨.
- [ ] 동일 Provider Refresh 중복 실행이 방지됨.
- [ ] Model Discovery 미지원/실패 시 하드코딩 모델 목록이 생성되지 않음.
- [ ] Container restart/redeploy 후 SQLite Model Catalog Cache가 유지됨.
