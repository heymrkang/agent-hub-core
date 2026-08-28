# Agent Hub V1 Implementation Roadmap

> **Status:** Phase 11 Release Verification In Progress\
> **Source of Truth:** `.plan/PROJECT_PLAN.md`\
> **Execution Rule:** 반드시 Phase 단위로 구현 → 검증 → 커밋 → 상태 갱신
> → 다음 Phase 순서로 진행한다.

이 문서는 `PROJECT_PLAN.md`에 정의된 Agent Hub V1 아키텍처를 실제 개발
가능한 12단계(Phase 0 ~ Phase 11)로 분할한 실행 로드맵이다.

## 1. 단계별 요약 및 상태

| 마일스톤 | 대상 Phase | 단계명 | 핵심 검증 목표 | 상세 파일 | 상태 |
|---|---|---|---|---|---|
| **Deploy #1** | **Phase 0 + 1** | Baseline & Core Persistence | 컨테이너 기동, Telegram 인증, SQLite 영속화, 세션 CRUD | `PHASE_00_BASELINE_AUDIT.md`, `PHASE_01_CORE_PERSISTENCE.md` | `DONE` |
| **Deploy #2** | **Phase 2 + 3** | Provider Abstraction & Job Queue | 동적 모델 검색, `/model`, 세션/동시성 큐, `/stop`, 재시작 복구 | `PHASE_02_PROVIDER_ABSTRACTION.md`, `PHASE_03_JOB_RUNTIME.md` | `DONE` |
| **Deploy #3** | **Phase 4 + 5** | Multi-Provider & Context Handoff | Antigravity CLI(agy) 통합, Codex ↔ Antigravity Handoff, 증분 복귀, `/compact` | `PHASE_04_CONTEXT_HANDOFF.md`, `PHASE_05_ANTIGRAVITY_INTEGRATION.md` | `DONE` |
| **Deploy #4** | **Phase 6 + 7** | Attachments & Global Memory | 사진/파일 업로드, Media Group, `/files`, `/download`, `/memory` 장기 기억 | `PHASE_06_ATTACHMENTS.md`, `PHASE_07_GLOBAL_MEMORY.md` | `DONE` |
| **Deploy #5** | **Phase 8** | Internal Scheduler | 자연어 등록/확인, 독립 실행, SKIP/Timeout, 결과 이력 | `PHASE_08_SCHEDULER.md` | `DONE` |
| **Deploy #6** | **Phase 9** | Infrastructure | SSH Registry, Docker Socket/CLI, Git/GitHub, Execution Profile | `PHASE_09_INFRASTRUCTURE.md` | `DONE` |
| **Deploy #7** | **Phase 10** | Operations & Backup | `/settings`, `/status`, `/usage`, `/health`, backup, notification, cleanup | `PHASE_10_OPERATIONS_BACKUP.md` | `DONE` |
| **Release Gate** | **Phase 11** | Hardening & V1 Release | regression, redeploy, provider handoff, restore, security, live E2E | `PHASE_11_HARDENING_RELEASE.md` | `IN_PROGRESS` |

| Phase | 단계명 | 상태 |
|---|---|---|
| **Phase 0** | Baseline Audit & Environment | `DONE` |
| **Phase 1** | Core Persistence & Session | `DONE` |
| **Phase 2** | Provider Abstraction & Model Discovery | `DONE` |
| **Phase 3** | Job Runtime & Queue | `DONE` |
| **Phase 4** | Context Management & Handoff | `DONE` |
| **Phase 5** | Antigravity Integration | `DONE` |
| **Phase 6** | Multi-Attachment | `DONE` |
| **Phase 7** | Global Memory | `DONE` |
| **Phase 8** | Internal Scheduler | `DONE` |
| **Phase 9** | Infrastructure | `DONE` |
| **Phase 10** | Operations & Backup | `DONE` |
| **Phase 11** | Hardening & V1 Release | `IN_PROGRESS` |

### Phase 11 현재 검증 상태

- GitHub Actions Phase 11 regression baseline 통과.
- WAL-safe pre-migration snapshot, newer-schema abort, restart interruption/no-auto-rerun, persistent-state redeploy simulation, Core Backup restore 자동 검증 통과.
- Coolify redeploy 후 DB v11, provider credential state, model catalog, Docker, Git/GitHub, SSH registry, `/data` 및 `/workspace` health 확인.
- Telegram 실환경에서 Codex 실행 → Antigravity handoff/실행 → Codex incremental return 확인.
- Antigravity 명시적 `--model`과 `--effort` 충돌을 실환경에서 발견하여 수정했고 재배포 후 정상 실행 확인.
- Telegram `getUpdates` 409 conflict는 초기부터 관찰된 known operational issue로 유지하며, 실제 Telegram request/response E2E는 정상 동작함을 별도로 검증한다.
- Phase 11의 나머지 release gate가 완료되기 전에는 V1 Released 또는 Phase 11 DONE으로 표시하지 않는다.

## 2. Phase 실행 규칙

각 Phase는 다음 순서를 지킨다.

1. 해당 Phase MD와 `PROJECT_PLAN.md`를 먼저 읽는다.
2. 현재 코드와 계획이 충돌하면 임의 구현하지 말고 충돌을 기록한다.
3. 해당 Phase 범위만 구현한다.
4. Phase에 명시된 Unit/Integration Test를 작성하고 실행한다.
5. 기존 완료 Phase의 회귀 테스트도 실행한다.
6. 애플리케이션 Build/Startup을 확인한다.
7. 검증 기준을 모두 만족해야 Phase를 `DONE`으로 변경한다.
8. `PROJECT_PLAN.md` 및 관련 Phase 문서를 실제 구현과 동기화한다.
9. Git Commit 후 다음 Phase로 이동한다.

## 3. 절대 준수 원칙

1. 토큰/API Key/OAuth Credential/SSH Private Key 등 비밀값을 로그에 남기지 않는다.
2. SSH 개인키 내용은 SQLite에 저장하지 않는다.
3. Provider 모델 목록을 하드코딩하지 않는다. CLI가 신뢰 가능한 Discovery를 제공하지 않으면 `UNSUPPORTED`로 처리한다.
4. 존재하지 않는 Usage/Token/Context 수치를 추정하지 않는다. `NULL/UNKNOWN`을 유지한다.
5. Provider Handoff가 성공하기 전에 `active_provider`를 변경하지 않는다.
6. Native Compact 때문에 Canonical Message를 삭제하지 않는다.
7. Provider 기능이 없을 때 다른 기능을 같은 기능인 것처럼 자동 Fallback하지 않는다.
8. Migration 실패 상태에서 애플리케이션을 계속 기동하지 않는다.
9. 각 Phase 완료 후 전체 애플리케이션은 Build/Startup 가능한 상태여야 한다.
10. Phase 11에 테스트를 몰지 않는다. 각 Phase에서 해당 기능 테스트를 함께 작성한다.
11. `/data`는 영속 상태이며 컨테이너는 Disposable이어야 한다.
12. V1 범위를 임의로 확장하지 않는다. 신규 아이디어는 Backlog로 보낸다.

## 4. Capability-First 원칙

Codex/Antigravity CLI 동작은 추측하지 않는다. 설치된 고정 버전에서 실제 명령과 출력을 검증한다.

특히 다음은 Capability Audit 대상이다.

- Auth persistence
- Non-interactive execution
- Native session create/resume
- Same-provider model switching
- Model discovery
- Usage/quota
- Context metrics
- Native compact
- Attachment/image support
- Machine-readable output
- Cancellation
- Sandbox/approval mapping

## 5. V1 완료 조건

Phase 0 ~ 10이 `DONE`이고 Phase 11의 실제 E2E/복구 리허설 및 Release Gate까지 통과해야만 V1 완료로 간주한다.
