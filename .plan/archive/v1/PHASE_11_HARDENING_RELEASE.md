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
- [x] **Execution Profile Isolation**
  - persistent development root를 `/home/dev`로 확정.
  - `READ_ONLY`: `/home/dev` read-only, container root read-only.
  - `WORKSPACE`: `/home/dev` read-write, `/home/dev` 밖 container root write 차단.
  - `FULL_ACCESS`: SSH/Docker/Git 등 인프라 권한 허용.
  - Linux device namespace `/dev`를 persistent volume으로 덮어쓰지 않음.
  - 실제 Telegram runtime에서 `/home` write 차단, WORKSPACE의 `/home/dev` write 성공, READ_ONLY의 `/home/dev` 신규 write 차단 확인.
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
  - repository review에서 release-blocking secret exposure 미확인.
- [x] **Documentation / Release**
  - `README.md`에 persistent mounts, execution profiles, provider login, SSH key, docker.sock warning, backup/restore, health, CLI update 절차 반영.
  - `/profile` UI와 `ROADMAP.md`를 `/home/dev` 기준으로 동기화.
  - 실제 Telegram `/profile` 반영 확인.
  - V1 release baseline 확정.

## 4. 생성 / 수정 파일

- `tests/unit/*`
- `tests/integration/*`
- `tests/e2e/v1-lifecycle.test.js`
- `tests/e2e/redeploy-recovery.test.js`
- `tests/e2e/backup-restore.test.js`
- `.github/workflows/phase11-regression.yml`
- `README.md`
- `src/telegram/commands/profile.js`
- `.plan/PHASE_11_HARDENING_RELEASE.md`
- `.plan/ROADMAP.md`

## 5. V1 Release Gate

- [x] 모든 Unit/Integration/local E2E Regression 통과.
- [x] V1 실제 Telegram provider lifecycle/handoff 확인.
- [x] Backup Restore rehearsal 통과.
- [x] Restart/Redeploy 복구 검증.
- [x] Provider Isolation 검토/실행 검증.
- [x] Execution Profile filesystem isolation runtime 검증.
- [x] Secret leakage 정책 및 repository review 통과.
- [x] `/profile` 최종 UI runtime 반영 확인.
- [x] 운영 문서와 구현 baseline 동기화.
- [x] Phase 0 ~ 11 모두 `DONE`.

## 6. Phase 11 최종 검증 기록 — 2026-08-29

- Node 20 built-in `node:test` 기반 `npm test` regression baseline을 구축했다.
- GitHub Actions `Phase 11 Regression` 최신 감사 대상 main run `33217103349`가 commit `26975db2c82d470258b3415bb14fa39a8597a70b`에서 `success`로 완료됐다.
- `package-lock.json` drift를 동기화하여 deterministic `npm ci` regression을 복구했다.
- Telegram authorization fail-closed/allowed-user regression을 추가했다.
- WAL SQLite pre-migration snapshot을 FULL checkpoint 후 standalone copy + `PRAGMA quick_check` 검증 방식으로 hardening했다.
- newer-schema startup abort, restart interruption/no-auto-rerun, persistent DATA_DIR redeploy simulation, Core Backup restore를 자동 검증한다.
- queue concurrency regression을 추가했고 settings 초기화까지 포함해 regression에서 통과했다.
- Coolify runtime에서 DB v11, health endpoint/container health, Codex/Antigravity, model catalog, Docker, Git/GitHub, SSH, `/data`, backup 기능을 확인했다.
- development root는 `/home/dev`, Git repository 기본 root는 `/home/dev/workspace`로 정리했다.
- Dockerfile, docker-compose, `.env.example`, Codex adapter, Antigravity adapter의 development-root baseline이 `/home/dev`로 일치한다.
- Coolify/Docker persistent development mount는 host development storage를 `/home/dev`로 연결하며 Linux device namespace `/dev`를 덮어쓰지 않는다.
- Codex restricted helper는 immutable root filesystem을 사용하고 `/home/dev`만 READ_ONLY=`ro`, WORKSPACE=`rw`로 mount한다.
- 실제 Telegram 검증에서 WORKSPACE는 `/home`에 파일/디렉토리를 만들지 못하고 `/home/dev`에는 쓸 수 있으며, READ_ONLY는 `/home/dev`의 기존 파일을 읽을 수 있지만 신규 파일 생성은 `Read-only file system`으로 차단됐다.
- `/profile`은 `READ_ONLY=/home/dev 읽기 전용`, `WORKSPACE=/home/dev 읽기/쓰기`, `FULL_ACCESS=/home/dev + 인프라` 의미로 동기화됐고 실제 Telegram 배포 반영까지 확인했다.
- 실제 Telegram에서 Codex ↔ Antigravity handoff/incremental return 및 background session completion notification이 동작함을 확인했다.
- Full Backup의 SSH key/log/existing backup 제외, Core retention 7, 30-day cleanup, secret redaction은 Phase 10 최종 감사 결과를 release evidence로 승계했다.
- Telegram `409 Conflict: terminated by other getUpdates request`는 동일 Bot Token의 중복 polling instance가 있을 때 발생하는 운영 이슈다. Core/provider release blocker로 분류하지 않으며, 지속 발생 시 Coolify에서 polling instance를 1개로 유지한다.
- 단발성 Antigravity `status=CANCELED`는 이후 정상 요청 성공으로 재현되지 않았고 원인을 단정하지 않는다. 재발 시 provider output/context를 수집해 별도 결함으로 추적한다.

## 7. Final Audit — PASS

2026-08-29 최종 감사 결과 **PASS**.

- Release-blocking 미완료 체크리스트 없음.
- 최신 감사 대상 main regression `33217103349` success.
- runtime execution-profile isolation과 `/profile` UI가 동일한 `/home/dev` 계약을 사용함.
- `/dev` device namespace masking 회귀 없음.
- V1 release 문서와 현재 runtime/deployment baseline의 핵심 경로가 동기화됨.

### 비차단 후속 정리

`.plan/PHASE_11_SYSTEM_RESOURCES.md`는 V1 Release Gate의 Phase 11과 별개의 후속 기능 초안인데 번호가 중복되어 있다. 이 문서는 V1 Phase 11 완료를 막지 않으며, 실제 착수 전에 후속 Phase 번호로 재지정한다.

## 8. Release Baseline

Phase 11을 `DONE`으로 종료한다. Agent Hub Core는 **V1 Released baseline**으로 간주한다.

이후 신규 기능은 기존 V1 release gate를 다시 열지 않고 별도 Phase/Backlog에서 진행하며, V1 회귀가 발견될 경우 regression test를 추가해 수정한다.
