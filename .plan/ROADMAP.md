# Agent Hub Core Roadmap

> **Status:** V1 Released\
> **Architecture:** `.plan/PROJECT_PLAN.md`\
> **Execution Rule:** Phase 단위로 구현 → 검증 → 커밋 → 상태 갱신

Agent Hub V1의 Phase 0 ~ 11 구현 및 release verification이 완료되었다.

## 1. V1 단계별 상태

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

- Phase 11 Final Audit: `PASS`.
- deterministic `npm ci` dependency baseline 복구 완료.
- Telegram authorization, WAL-safe migration snapshot, newer-schema abort, restart interruption/no-auto-rerun, redeploy persistence, Core Backup restore, queue concurrency regression 구축.
- Coolify runtime health, DB v11, persistent storage, Codex/Antigravity, Docker, Git/GitHub, SSH, backup 확인.
- 실제 Telegram provider lifecycle 및 Codex ↔ Antigravity handoff/incremental return 확인.
- READ_ONLY/WORKSPACE restricted filesystem 경계를 `/home/dev` 기준으로 runtime 검증했다.
- `/profile` UI 역시 `/home/dev` 기준으로 실제 배포 반영 확인했다.
- Phase 10 scheduler/notification/backup/cleanup/secret-redaction runtime 및 감사 결과를 release evidence로 승계했다.
- README에 운영/복구/보안 주의사항과 deploy checklist를 문서화했다.

## 3. V1 운영 원칙

1. `/data`, `/home/dev`, provider auth 디렉토리는 persistent mount를 유지한다. `/home/dev/workspace`는 Git repository의 기본 영역이다.
2. Linux device namespace `/dev`를 일반 persistent storage로 덮어쓰지 않는다.
3. Codex `READ_ONLY`는 `/home/dev`를 읽기 전용으로, `WORKSPACE`는 `/home/dev`를 읽기/쓰기로 제한하고, `FULL_ACCESS`만 SSH/Docker/Git 등 인프라 권한을 허용한다. Provider capability가 `PARTIAL`인 경우 UI/문서에서 그 한계를 숨기지 않는다.
4. 동일 Telegram Bot Token의 polling instance는 하나만 실행한다.
5. deploy 후 container health와 `/status`를 확인한다.
6. Provider 모델 목록/기능은 capability-driven discovery를 유지하고 임의 hardcode/fallback하지 않는다.
7. Token/API Key/OAuth Credential/SSH Private Key는 로그/DB/일반 backup에 노출하지 않는다.
8. DB migration은 WAL-safe pre-migration snapshot과 safe-abort 원칙을 유지한다.
9. V1 변경은 regression을 통과해야 한다.
10. 신규 기능은 V1 baseline을 유지한 채 후속 Phase에서 진행한다.

## 4. Post-V1 Phase Queue

| Phase | 단계명 | 상태 | 비고 |
|---|---|---|---|
| Phase 12 | Backup/Recovery/Hardening 중복 계획 | `SKIPPED / SUPERSEDED` | Phase 10~11에서 구현·검증 완료된 범위와 중복되어 별도 구현하지 않음 |
| Phase 13 | Mobile Preview Runtime & Preview Manager | `DONE` | 2026-08-31 모바일 개발 루프 E2E 완료 |
| Phase 14 | System & Resource Observability (`/system`) | `DONE` | 2026-09-01 Coolify runtime audit PASS |
| Phase 15 | Unassigned | `SKIPPED / UNASSIGNED` | 별도 구현 범위 없이 건너뛰고 Phase 16으로 진행 |
| Phase 16 | Feature Stabilization & Optimization | `PLANNED` | Canonical Compact, Model Thinking, Provider Usage/Quota |
| Phase 17 | Backend API Preview & Inspector | `PLANNED` | NestJS/OpenAPI 기반 API Preview와 개발 데이터 보안 경계 |
| Phase 18 | Agent Extensibility — MCP & Skills | `PLANNED` | Provider native MCP/Skills 조회·관리·인증·권한 정책 |

### Phase 12를 스킵하는 이유

기존 Phase 12 초안의 핵심인 Backup/Restore, Production Hardening, V1 Regression, Release 판정은 이미 Phase 10과 Phase 11에서 완료됐다. 같은 Release Gate를 다시 여는 대신 Phase 12는 기록상 `SKIPPED / SUPERSEDED`로 남기고 신규 기능은 Phase 13부터 진행한다.

### Phase 13

`PHASE_13_PREVIEW_MANAGER.md`의 Mobile Preview Runtime & Preview Manager 구현과 실제 홈서버 배포 검증을 완료했다. Telegram 자연어 요청 → 코드 수정 → Preview 생성 → 모바일 확인 → 후속 수정 → HMR 반영 루프를 통과했다.

### Phase 14

`PHASE_14_SYSTEM_RESOURCES.md`를 기준으로 `/system` 명령어와 System & Resource Observability 구현 및 실제 Coolify runtime 검증을 완료했다.

`/system`은 `/status`와 분리된 read-only 관찰/진단 기능이며 destructive Docker/host control을 포함하지 않는다. 등록 서버의 CPU/RAM/Disk/OS/Docker/Uptime과 Agent Hub runtime을 확인하며, 실제 CPU 점유 프로세스와 온도 변화를 정확히 반영하는 것까지 검증했다. Disk는 마운트된 루트 및 외장 블록 디바이스를 자동 탐지하고 사용량/전체 용량을 개별 표시한다.

### Phase 15

별도로 확정된 기능 범위와 구현 기록이 없어 `SKIPPED / UNASSIGNED`로 종료했다. 누락된 기능을 소급해 Phase 15로 만들지 않으며 다음 구현 단계는 Phase 16이다.

### Phase 16

`PHASE_16_STABILITY_OPTIMIZATION.md`를 기준으로 Agent Hub Canonical Context Compact, Provider별 Model Reasoning/Thinking Level, Codex/Antigravity Usage/Quota 조회를 구현한다.

### Phase 17

`PHASE_17_BACKEND_API_PREVIEW.md`를 기준으로 기존 Preview Manager를 NestJS/OpenAPI 백엔드까지 확장한다. Cloudflare Access와 개발 DB 격리를 외부 API Preview URL의 필수 조건으로 둔다.

### Phase 18

`PHASE_18_MCP_SKILLS.md`를 기준으로 Codex/Antigravity native MCP와 Skills를 조회·사용하고, 이후 설치·인증·외부 side effect 권한 관리까지 단계적으로 확장한다.

## 5. Known Operational Notes

- Telegram `409 Conflict: terminated by other getUpdates request`가 지속되면 Coolify에서 동일 Bot Token을 polling하는 instance/process가 둘 이상인지 확인한다.
- 단발성 Antigravity `status=CANCELED`는 원인을 추정하지 않는다. 반복 재현될 때 provider output/context를 수집해 별도 결함으로 추적한다.
- Provider CLI 버전 변경 시 Dockerfile pin/checksum과 regression baseline을 함께 갱신한다.
- `WORKSPACE`라는 Profile 이름은 권한 단계의 명칭이며 경로 `/workspace`를 뜻하지 않는다. 현재 development root는 `/home/dev`이다.

## 6. 다음 작업 시작점

새 채팅에서 후속 개발을 시작할 때의 기준점은 다음과 같다.

```text
V1 Released
Phase 0 ~ 11: DONE
Phase 12: SKIPPED / SUPERSEDED
Phase 13: DONE — Mobile Preview Runtime & Preview Manager
Phase 14: DONE — /system System & Resource Observability
Phase 15: SKIPPED / UNASSIGNED
Phase 16: PLANNED — Stability & Optimization
Phase 17: PLANNED — Backend API Preview & Inspector
Phase 18: PLANNED — MCP & Skills
Development root: /home/dev
Git repositories: /home/dev/workspace
```

V1 회귀가 발견되면 신규 Phase 진행보다 해당 결함 수정과 regression 추가를 우선한다.
