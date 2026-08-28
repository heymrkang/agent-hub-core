# Phase 11: Hardening, Verification & V1 Release

**Status: IN PROGRESS**

## 1. 목표

-   Phase 0 ~ 10에서 이미 작성한 Unit/Integration Test를 기반으로 최종
    통합 검증한다.
-   Restart/Redeploy/Provider Failure/DB Failure/Concurrency/Backup
    Restore를 실제 환경에서 검증한다.
-   V1 Success Scenario E2E를 통과하고 Release Baseline을 확정한다.

## 2. 선행 조건

-   Phase 0 ~ Phase 10 모두 `DONE`.
-   각 Phase 자체 Unit/Integration Test 통과.
-   `PROJECT_PLAN.md`와 구현 상태 동기화.

## 3. 세부 작업 항목

-   [ ] **전체 Regression**
    -   모든 Unit Test.
    -   모든 Integration Test.
    -   Docker Build.
    -   Clean startup.
-   [ ] **Restart / Redeploy**
    -   Running Job → `INTERRUPTED`.
    -   자동 재실행 없음.
    -   Session/Message/Memory/Schedule/SSH Registry/Attachment metadata
        유지.
    -   Provider auth persistence가 해당 CLI 정책 내에서 유지.
-   [ ] **Provider Isolation**
    -   Codex auth failure.
    -   Gemini auth failure.
    -   한 Provider 장애가 다른 Provider/Core를 중단시키지 않음.
-   [ ] **DB Failure / Migration**
    -   Migration failure → safe startup abort.
    -   Pre-migration snapshot 확인.
    -   App보다 DB schema가 새로우면 명확한 abort.
-   [ ] **Concurrency**
    -   동일 Session FIFO.
    -   다중 Session.
    -   Provider concurrency limit.
    -   Queue saturation.
    -   `/stop`.
    -   Background Session completion.
-   [ ] **Scheduler**
    -   Natural language registration.
    -   Confirmation.
    -   Isolated execution.
    -   Overlap `SKIP`.
    -   Timeout.
    -   No automatic retry.
    -   Missed run no replay.
    -   전체 execution result/history.
-   [ ] **Backup Restore Rehearsal**
    -   Core Backup을 새 빈 `/data` 환경에 복원.
    -   DB integrity.
    -   Session/Settings/Memory/Schedules 정상 복원.
    -   SSH key 제외 정책 확인.
    -   Restore 절차 문서화.
-   [ ] **V1 E2E Success Scenario**
    -   `/new`
    -   Codex conversation
    -   multiple attachments
    -   same-provider model change
    -   Codex → Gemini Handoff
    -   Gemini conversation
    -   Gemini → Codex incremental return
    -   Global Memory 확인
    -   natural-language Schedule registration
    -   independent Scheduler execution + Telegram notification
    -   SSH alias test
    -   Docker access/status test
    -   Core Backup
    -   Container redeploy
    -   persistent state verification
-   [ ] **Security / Secret Review**
    -   Logs.
    -   DB.
    -   Backup.
    -   Telegram errors.
    -   SSH private keys.
    -   Provider auth files.
    -   Unauthorized Telegram update.
-   [ ] **Documentation / Release**
    -   `README.md`.
    -   install/deploy.
    -   `/data` mount.
    -   Provider login.
    -   SSH key placement.
    -   Docker socket warning.
    -   Backup/restore.
    -   CLI version update procedure.
    -   `PROJECT_PLAN.md` → `V1 Released`.
    -   Git release/tag 준비.

## 4. 생성 / 수정 대상 파일

-   `tests/e2e/v1-lifecycle.test.js`
-   `tests/e2e/redeploy-recovery.test.js`
-   `tests/e2e/backup-restore.test.js`
-   `README.md`
-   `.plan/PROJECT_PLAN.md`
-   `.plan/ROADMAP.md`

## 5. V1 Release Gate

다음이 모두 만족되어야 V1 Release 가능하다.

-   [ ] 모든 Unit/Integration Test 통과.
-   [ ] E2E Success Scenario 통과.
-   [ ] Backup Restore 실제 리허설 성공.
-   [ ] Restart/Redeploy 복구 성공.
-   [ ] Provider Isolation 성공.
-   [ ] Secret leakage 검토 통과.
-   [ ] `PROJECT_PLAN.md`와 구현이 일치.
-   [ ] 모든 Phase 상태 `DONE`.

## 6. 초기 감사 메모 — 2026-08-28

- Phase 11을 `IN PROGRESS`로 전환했다.
- 현재 repository에는 `tests/` 디렉토리와 `npm test` script가 없어, 계획서가 전제한 자동 Unit/Integration Regression baseline은 아직 존재하지 않는다. Phase 11 Release Gate blocker로 취급한다.
- Restart 시 `JobRuntime.recoverInterruptedJobs()`가 `RUNNING` job을 `INTERRUPTED` + `AGENT_HUB_RESTART`로 전환하고 startup에서 호출되는 구현은 확인했다.
- Telegram authorization은 허용 ID가 없으면 fail-closed이며 비인가 update를 차단하는 구현을 확인했다.
- DB가 application code보다 높은 schema version이면 startup abort하는 guard를 확인했다.
- WAL 모드 SQLite에서 기존 pre-migration snapshot이 메인 `.db` 파일만 복사하던 위험을 발견했다. Phase 11 감사 중 FULL WAL checkpoint 후 standalone snapshot 복사 + `PRAGMA quick_check` 검증으로 hardening했다.
- Docker HEALTHCHECK와 내부 `/health` endpoint wiring은 존재한다. 실제 Docker build/clean startup 및 redeploy persistence는 런타임 검증이 필요하다.

## 7. 자동 Regression 진행 — 2026-08-28

- Node 20 built-in `node:test` 기반 `npm test` regression baseline을 추가했다.
- GitHub Actions `Phase 11 Regression` workflow를 추가했다.
- Telegram authorization fail-closed/allowed user regression을 추가했다.
- WAL pre-migration snapshot이 committed WAL data를 포함하고 `PRAGMA quick_check=ok`인지 자동 검증한다.
- DB schema가 application migration보다 높은 경우 startup exit code 1 + 명확한 fatal message를 자동 검증한다.
- process restart simulation에서 `RUNNING` job이 `INTERRUPTED` + `AGENT_HUB_RESTART`로 전환되고 `QUEUED` job은 자동 재실행되지 않는 것을 자동 검증한다.
- redeploy simulation에서 동일 persistent `DATA_DIR`를 두 process가 순차 사용했을 때 Session/Message/Memory/Schedule/SSH Registry가 유지되는 것을 자동 검증한다.
- Core Backup을 빈 restore target에 복사해 `PRAGMA quick_check`, Session/Settings/Memory/Schedule 복원을 자동 검증한다.
- `tests/e2e/v1-lifecycle.test.js`, `redeploy-recovery.test.js`, `backup-restore.test.js`를 생성했다. 실제 Telegram/provider/Coolify lifecycle은 `PHASE11_LIVE_E2E` release gate로 분리했다.
- README를 현재 V1 architecture 기준으로 갱신하고 persistent mounts, provider login, SSH key, docker.sock warning, backup/restore, health, CLI update 절차를 문서화했다.
- GitHub Actions run `33173685741`에서 현재 Unit/Integration/local E2E suite가 성공했다. 실제 Coolify Docker build/clean startup/provider isolation/live lifecycle은 아직 별도 runtime 검증이 필요하다.
- 기존 `package-lock.json`이 `better-sqlite3`/`sharp` 추가 전 상태라 `npm ci`가 실패하는 legacy lockfile drift를 발견했다. CI는 우선 `npm install`로 regression을 실행하며, lockfile 동기화는 release hygiene 잔여 작업으로 유지한다.

**코드 작성 완료만으로 V1 완료로 간주하지 않는다.**
