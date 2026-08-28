# Phase 11: Hardening, Verification & V1 Release

**Status: DONE**

## 1. 목표

- Phase 0 ~ 10 구현을 최종 통합 검증한다.
- Restart/Redeploy/Provider Failure/DB Failure/Concurrency/Backup Restore를 검증한다.
- V1 Success Scenario와 Release Baseline을 확정한다.

## 2. 선행 조건

- Phase 0 ~ Phase 10 모두 `DONE`.
- 자동 regression baseline 존재 및 통과.
- 운영 문서와 실제 구현 상태 동기화.

## 3. 세부 작업 항목

- [x] **전체 Regression**
  - Unit/Integration/local E2E regression.
  - deterministic `npm ci` dependency baseline.
  - Docker/Coolify startup health runtime 확인.
- [x] **Restart / Redeploy**
  - Running Job → `INTERRUPTED`.
  - 자동 재실행 없음.
  - Session/Message/Memory/Schedule/SSH Registry persistent-state 검증.
  - Provider auth persistent mount 검증.
- [x] **Provider Isolation**
  - Provider별 adapter/health/auth 상태 독립 처리.
  - 한 Provider 오류가 Core/다른 Provider를 종료하지 않는 구조 확인.
  - Codex/Antigravity 실제 Telegram 실행 및 handoff 검증.
- [x] **DB Failure / Migration**
  - Migration failure → safe startup abort.
  - WAL-safe pre-migration snapshot + `PRAGMA quick_check`.
  - App보다 DB schema가 새로우면 명확한 abort.
- [x] **Concurrency**
  - Queue concurrency regression.
  - 동일 Session FIFO / 다중 Session queue 구조 검증.
  - `/stop` 및 background completion 기존 runtime 검증 유지.
- [x] **Scheduler**
  - Phase 8에서 natural-language registration, confirmation, isolated execution, overlap SKIP, timeout, no retry, missed-run no replay, history 검증 완료.
  - Phase 11에서 regression 대상과 운영 상태 재확인.
- [x] **Backup Restore Rehearsal**
  - Core Backup을 빈 restore target으로 복원하는 자동 E2E.
  - DB integrity + Session/Settings/Memory/Schedule 대표 데이터 검증.
  - SSH key 제외 정책 및 restore 절차 문서화.
- [x] **V1 E2E Success Scenario**
  - `/new`, provider conversation/handoff, persistent session lifecycle은 실제 Telegram/Coolify 사용으로 검증.
  - attachments, memory, scheduler, SSH, Docker, backup은 각 완료 Phase의 runtime verification을 release evidence로 승계.
  - redeploy persistence 및 health 검증 완료.
- [x] **Security / Secret Review**
  - Telegram authorization fail-closed regression.
  - secret redaction / SSH private-key backup 제외 정책 재확인.
  - provider auth는 persistent native CLI state로 분리.
  - repository code search에서 명시적 secret logging 패턴 미검출.
- [x] **Documentation / Release**
  - `README.md`에 install/deploy, persistent mounts, provider login, SSH key, docker.sock warning, backup/restore, health, CLI update 절차 반영.
  - `ROADMAP.md` Phase 11/V1 상태 동기화.
  - V1 release baseline 확정.

## 4. 생성 / 수정 파일

- `tests/unit/*`
- `tests/integration/*`
- `tests/e2e/v1-lifecycle.test.js`
- `tests/e2e/redeploy-recovery.test.js`
- `tests/e2e/backup-restore.test.js`
- `.github/workflows/phase11-regression.yml`
- `README.md`
- `.plan/PHASE_11_HARDENING_RELEASE.md`
- `.plan/ROADMAP.md`

## 5. V1 Release Gate

- [x] 모든 Unit/Integration/local E2E Regression 통과.
- [x] V1 실제 Telegram provider lifecycle/handoff 확인.
- [x] Backup Restore rehearsal 통과.
- [x] Restart/Redeploy 복구 검증.
- [x] Provider Isolation 검토/실행 검증.
- [x] Secret leakage 정책 및 repository review 통과.
- [x] 운영 문서와 구현 baseline 동기화.
- [x] Phase 0 ~ 11 모두 `DONE`.

## 6. Phase 11 최종 검증 기록 — 2026-08-29

- Node 20 built-in `node:test` 기반 `npm test` regression baseline을 구축했다.
- GitHub Actions `Phase 11 Regression`을 구축했고 최신 main regression run `33185074907`이 `success`로 완료됐다.
- `package-lock.json` drift를 동기화하여 deterministic `npm ci` regression을 복구했다.
- Telegram authorization fail-closed/allowed-user regression을 추가했다.
- WAL SQLite pre-migration snapshot을 FULL checkpoint 후 standalone copy + `PRAGMA quick_check` 검증 방식으로 hardening했다.
- newer-schema startup abort, restart interruption/no-auto-rerun, persistent DATA_DIR redeploy simulation, Core Backup restore를 자동 검증한다.
- queue concurrency regression을 추가했고 settings 초기화까지 포함해 최신 regression에서 통과했다.
- Coolify runtime에서 DB v11, health endpoint/container health, Codex/Antigravity, model catalog, Docker, Git/GitHub, SSH, `/data`, `/workspace`, backup 기능을 확인했다.
- 실제 Telegram에서 Codex ↔ Antigravity handoff/incremental return 및 background session completion notification이 동작함을 확인했다.
- Full Backup의 SSH key/log/existing backup 제외, Core retention 7, 30-day cleanup, secret redaction은 Phase 10 최종 감사 결과를 release evidence로 승계했다.
- Telegram `409 Conflict: terminated by other getUpdates request`는 동일 Bot Token의 중복 polling instance가 있을 때 발생하는 운영 이슈다. Core/provider release blocker로 분류하지 않으며, 지속 발생 시 Coolify에서 polling instance를 1개로 유지한다.
- 단발성 Antigravity `status=CANCELED`는 이후 정상 요청 성공으로 재현되지 않았고 원인을 단정하지 않는다. 재발 시 provider output/context를 수집해 별도 결함으로 추적한다.

## 7. Release Baseline

Phase 11을 `DONE`으로 종료한다. Agent Hub Core는 **V1 Released baseline**으로 간주한다.

이후 신규 기능은 기존 V1 release gate를 다시 열지 않고 별도 Phase/Backlog에서 진행하며, V1 회귀가 발견될 경우 regression test를 추가해 수정한다.
