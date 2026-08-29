# Phase 8: Internal Scheduler Engine

## Status

`DONE` — 2026-08-26

Phase 8 구현, hardening audit, migration v8 배포 및 핵심 runtime E2E 검증을 완료했다.

## 1. 목표

- [x] OS Cron 없이 Agent Hub 자체 Scheduler를 구축한다.
- [x] User Schedule과 Internal System Job을 SQLite 기반으로 관리한다.
- [x] 자연어 → 구조화 Intent → 검증 → Telegram 확인 → 등록 흐름을 구현한다.
- [x] Scheduler 실행 결과를 디버깅 가능한 수준으로 전체 보존한다.
- [x] Provider 모델 목록을 백그라운드에서 조회하여 SQLite에 캐시하고 `/model` UI가 Cache를 즉시 사용한다.

## 2. 완료된 핵심 구현

- [x] `schedules`, `schedule_runs`, Provider Model Catalog Cache schema 및 migration 적용.
- [x] Agent Hub Internal Scheduler Engine. OS Cron 사용 없음.
- [x] User/System schedule 구분.
- [x] Schedule별 Provider / Model / Profile / Timezone / Timeout / Enabled / Overlap / Next Run 관리.
- [x] 자연어 Schedule Intent 해석 및 Telegram confirmation 후 등록.
- [x] 매 Scheduler 실행마다 새로운 one-shot isolated system session 생성 후 종료 시 삭제 처리. Native provider session 재사용 없음.
- [x] V1 Overlap policy `SKIP` 및 `SKIPPED` 실행 기록.
- [x] Automatic Retry 없음.
- [x] Schedule별 timeout 및 Job Runtime 취소 연결.
- [x] 다운타임 중 missed run 자동 replay 금지 및 `MISSED` 기록.
- [x] Scheduler Provider Queue Grace 지원 (`SCHEDULER_QUEUE_GRACE_SECONDS`, 기본 30초).
- [x] `schedule_runs.job_id`를 실제 Job Runtime id와 연결.
- [x] 실행 결과/오류/Telegram 알림 Secret Redaction.
- [x] 전체 실행 결과 `output_text`, 요약 `output_summary`, 오류/상태/실행시간 기록.
- [x] Manual `지금 실행`은 schedule의 enabled/next-run 정책을 변경하지 않음.
- [x] `/schedule` List → Detail UI, 페이지당 5개 및 pagination.
- [x] enable/disable, 즉시 실행, 최근 실행 이력, 삭제 지원.

## 3. Provider Model Catalog

- [x] Codex/Antigravity 모델 Discovery를 ProviderAdapter를 통해 동적으로 수행하며 모델명을 Agent Hub에 하드코딩하지 않는다.
- [x] Internal SYSTEM schedule을 통한 주기적 Model Catalog Refresh.
- [x] 기본 Refresh 주기 6시간 및 설정 가능한 구조.
- [x] SQLite `provider_models`, `provider_model_cache` 저장.
- [x] `/model → Provider`는 CLI 실시간 조회 대신 SQLite Cache를 즉시 사용.
- [x] Startup을 Model Discovery 완료까지 block하지 않음.
- [x] 최초 Empty 상태 및 수동 Refresh UX.
- [x] Refresh 성공 시 원자적 Catalog 교체 및 `FRESH` 처리.
- [x] Refresh 실패 시 기존 정상 Cache 유지 및 `STALE` 처리.
- [x] `last_attempt_at`, `last_success_at`, 정리된 `last_error` 기록.
- [x] 동일 Provider Refresh 중복 실행 방지.
- [x] Discovery 실패 시 하드코딩 fallback 생성 금지.
- [x] Antigravity `agy models`의 non-TTY hang을 pseudo-TTY 방식으로 해결하고 실제 14개 모델 Discovery/Cache 검증 완료.
- [x] Telegram model callback payload 길이 제한 대응 및 PTY 출력 정제.

## 4. Migration / 배포 검증

- [x] 기존 Scheduler/Model Cache migration 적용.
- [x] `v8: scheduler_execution_isolation_cleanup` 적용 성공.
- [x] Pre-migration SQLite snapshot 생성 확인.
- [x] Redeploy 후 DB schema 최신 상태 확인.
- [x] Redeploy 후 Internal Scheduler 정상 시작.
- [x] 등록된 schedule 및 SQLite 데이터 영속성 확인.

## 5. Runtime 검증

- [x] 자연어 → 확인 → 승인 → DB 등록.
- [x] 자동 Scheduler 실행 및 Telegram 결과 수신.
- [x] Schedule 삭제.
- [x] 실행 기록 조회 및 SQLite 보존.
- [x] Redeploy 후 schedule 유지 및 missed execution replay 없음.
- [x] Scheduler 실행 중 일반 Telegram/Agent session 응답 가능.
- [x] Codex Model Catalog Cache 조회.
- [x] Antigravity Model Catalog 동적 Discovery 및 Cache 조회.
- [x] `/model` Cache 기반 즉시 렌더링 및 수동 Refresh.
- [x] Phase 8 hardening audit 반영 완료.

## 6. 운영 참고

Telegram `409 Conflict: terminated by other getUpdates request`는 Scheduler 기능 결함이 아니라 동일 Bot Token을 사용하는 복수 polling instance가 동시에 존재할 때 발생하는 별도 운영 이슈다. 지속 발생 시 중복 컨테이너/프로세스를 제거하여 polling instance를 하나만 유지한다.

## 7. 최종 판정

**PHASE 8 — DONE ✅**

Phase 8 범위의 Scheduler, isolated execution, execution history, Model Catalog caching, Telegram UX 및 hardening을 완료했다. 이후 추가 기능 또는 운영 개선은 후속 Phase에서 진행한다.
