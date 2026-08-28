# Agent Hub V1 Implementation Roadmap

> **Status:** V1 Released\
> **Source of Truth:** `.plan/PROJECT_PLAN.md`\
> **Execution Rule:** Phase 단위로 구현 → 검증 → 커밋 → 상태 갱신

Agent Hub V1의 Phase 0 ~ 11 구현 및 release verification이 완료되었다.

## 1. 단계별 상태

| 마일스톤 | 대상 Phase | 단계명 | 상태 |
|---|---|---|---|
| Deploy #1 | Phase 0 + 1 | Baseline & Core Persistence | `DONE` |
| Deploy #2 | Phase 2 + 3 | Provider Abstraction & Job Queue | `DONE` |
| Deploy #3 | Phase 4 + 5 | Multi-Provider & Context Handoff | `DONE` |
| Deploy #4 | Phase 6 + 7 | Attachments & Global Memory | `DONE` |
| Deploy #5 | Phase 8 | Internal Scheduler | `DONE` |
| Deploy #6 | Phase 9 | Infrastructure | `DONE` |
| Deploy #7 | Phase 10 | Operations & Backup | `DONE` |
| Release Gate | Phase 11 | Hardening & V1 Release | `DONE` |

| Phase | 단계명 | 상태 |
|---|---|---|
| Phase 0 | Baseline Audit & Environment | `DONE` |
| Phase 1 | Core Persistence & Session | `DONE` |
| Phase 2 | Provider Abstraction & Model Discovery | `DONE` |
| Phase 3 | Job Runtime & Queue | `DONE` |
| Phase 4 | Context Management & Handoff | `DONE` |
| Phase 5 | Antigravity Integration | `DONE` |
| Phase 6 | Multi-Attachment | `DONE` |
| Phase 7 | Global Memory | `DONE` |
| Phase 8 | Internal Scheduler | `DONE` |
| Phase 9 | Infrastructure | `DONE` |
| Phase 10 | Operations & Backup | `DONE` |
| Phase 11 | Hardening & V1 Release | `DONE` |

## 2. V1 Release Baseline — 2026-08-29

- GitHub Actions Phase 11 regression 최신 main run `33185074907`: `success`.
- deterministic `npm ci` dependency lockfile baseline 복구 완료.
- Telegram authorization, WAL-safe migration snapshot, newer-schema abort, restart interruption/no-auto-rerun, redeploy persistence, Core Backup restore, queue concurrency 자동 regression 구축.
- Coolify runtime health, DB v11, persistent storage, Codex/Antigravity, Docker, Git/GitHub, SSH, backup 확인.
- 실제 Telegram provider lifecycle 및 Codex ↔ Antigravity handoff/incremental return 확인.
- Phase 10 scheduler/notification/backup/cleanup/secret-redaction runtime 및 감사 결과를 release evidence로 승계.
- README에 운영/복구/보안 주의사항과 deploy checklist 문서화.

## 3. V1 운영 원칙

1. `/data`, `/workspace`, provider auth 디렉토리는 persistent mount를 유지한다.
2. 동일 Telegram Bot Token의 polling instance는 하나만 실행한다.
3. deploy 후 container health와 `/status`를 확인한다.
4. Provider 모델 목록/기능은 capability-driven discovery를 유지하고 임의 hardcode/fallback하지 않는다.
5. Token/API Key/OAuth Credential/SSH Private Key는 로그/DB/일반 backup에 노출하지 않는다.
6. DB migration은 WAL-safe pre-migration snapshot과 safe-abort 원칙을 유지한다.
7. V1 변경은 `npm test` regression을 통과해야 한다.
8. 신규 기능은 V1 baseline을 유지한 채 후속 Phase에서 진행한다.

## 4. Known Operational Notes

- Telegram `409 Conflict: terminated by other getUpdates request`가 지속되면 Coolify에서 동일 Bot Token을 polling하는 instance/process가 둘 이상인지 확인한다.
- 단발성 Antigravity `status=CANCELED`는 원인을 추정하지 않는다. 반복 재현될 때 provider output/context를 수집해 별도 결함으로 추적한다.
- Provider CLI 버전 변경 시 Dockerfile pin/checksum과 regression baseline을 함께 갱신한다.

## 5. 다음 단계

V1은 Release Baseline으로 고정한다. 이후 계획은 별도 Phase 문서를 기준으로 진행하며, V1 회귀가 발생하면 해당 결함을 먼저 수정하고 regression test를 추가한다.
