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
| Phase 16 | Feature Stabilization & Optimization | `DONE` | Canonical Compact, Model Thinking, Provider Usage/Quota 완료 |
| Phase 17 | Backend API Preview & Inspector | `DONE` | NestJS/OpenAPI 백엔드 프리뷰, Swagger 탐지, 개발 MariaDB 연동 및 실서버 검증 완료 |
| Phase 18 | V2 Native Session Compact & Rollover | `DONE` | /compact 시 모든 Provider Native Session 초기화 및 요약 부트스트랩 롤오버 완료 |
| Phase 20 | Coolify Deploy Integration & Voice Prompting (STT) | `PLANNED` | Coolify 배포 연동(`/deploy`), 배포 완료 수신 웹훅 알림, Whisper STT 음성 코딩 |
| Phase 21 | V2 LTS Final Hardening & Optimization | `PLANNED` | 토큰 다이어트, 퍼블릭 레포 보안 감사 및 환경변수화, 레거시 정리, V2 LTS 완결 |

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

`PHASE_16_STABILITY_OPTIMIZATION.md`를 기준으로 Agent Hub Canonical Context Compact, Provider별 Model Reasoning/Thinking Level, Codex/Antigravity Usage/Quota 조회를 구현한다. 16-1 조사, 16-2 수동 Canonical Compact, 16-3 context assembly/Auto Compact 경로, 16-4 Model Thinking, 16-5 Provider Usage/Quota를 완료했다. Codex는 app-server의 5시간/주간 quota를 표시하고 Antigravity는 구조화된 `/usage` 응답의 모델 그룹별 5시간/주간 잔여 quota를 표시한다. 현재 CLI가 context window/tokenizer를 노출하지 않아 운영 Auto Compact 판정은 `UNAVAILABLE`로 유지한다.

### Phase 17

`PHASE_17_BACKEND_API_PREVIEW.md`를 기준으로 기존 Preview Manager를 NestJS/OpenAPI 백엔드까지 확장했다. 17-0~17-8과 17-9 격리 MariaDB 자동 E2E를 완료하고, 실제 Coolify/Telegram에서 Swagger 탐지, 개발 MariaDB 연동 CRUD, 재시작, cleanup, Web Preview 호환성을 검증해 Phase를 종료했다.

### Phase 18

`PHASE_18_NATIVE_SESSION_COMPACT.md`를 기준으로 V2 Provider-Native Session First 구조에 맞게 `/compact`와 Auto Compact를 고도화한다. `/compact` 실행 시 DB 요약뿐만 아니라 해당 세션의 모든 Provider(Codex, Antigravity) Native Session을 `UNBOUND`로 리셋하여, 다음 턴에서 압축 요약본을 시드로 새 깨끗한 Native Session을 생성(Rollover)하도록 구현한다.

### Phase 19

`PHASE_19_MCP_SKILLS.md`를 기준으로 Agent Hub 단일 마스터(DB `mcp_servers` 및 `/data/skills`) 기반 Codex/Antigravity 전역 Dual-Sync 엔진과 Telegram UI(`/mcp`, `/skills`)를 구축했다. 실제 모바일 Telegram에서 `playwright` MCP 등록 및 `stealth_browser` 런타임 호출, Skills 마스터 동기화 검증을 마치고 공식 종료했다.

### Phase 20

`PHASE_20_DEPLOY_VOICE_QUOTA.md`를 기준으로 모바일 텔레그램 상에서의 개발 생산성과 운영 편의성을 극대화한다. Coolify Deploy Webhook을 통한 `/deploy` 명령어 및 배포 결과 수신 웹훅 알림 연동, OpenAI Whisper STT 기반 텔레그램 음성 코딩 지시를 구현한다. (오작동 우려 및 불필요한 복잡도를 방지하기 위해 Smart Quota는 제외하고 기존 `/usage`를 유지한다.)

### Phase 21

`PHASE_21_V2_LTS_HARDENING.md`를 기준으로 Agent Hub Core의 기능 개발을 공식 영구 동결(Feature Freeze)하고 최종 V2 LTS 버전으로 안착시킨다. 신규 기능 추가를 중단하고, 토큰 다이어트(시스템 프롬프트/컨텍스트 최적화), 레거시/오작동 명령어 정리, 퍼블릭 레포 보안 감사 및 하드코딩 환경변수화(`.env.example`), 전체 회귀 테스트 통과 및 V2 LTS 공식 릴리즈를 진행한다.

## 5. Known Operational Notes

- Telegram `409 Conflict: terminated by other getUpdates request`가 지속되면 Coolify에서 동일 Bot Token을 polling하는 instance/process가 둘 이상인지 확인한다.
- 단발성 Antigravity `status=CANCELED`는 원인을 추정하지 않는다. 반복 재현될 때 provider output/context를 수집해 별도 결함으로 추적한다.
- Provider CLI 버전 변경 시 Dockerfile pin/checksum과 regression baseline을 함께 갱신한다.
### 2026-09-03: Execution Profile 보안 격리 하드닝 및 Git 권한 현실화 (버그 수정)

- **배경**: `WORKSPACE` 프로필에서 Codex는 Docker 샌드박스로 물리 격리되었으나, Antigravity는 텍스트 프롬프트 가드레일에만 의존하여 외부 디렉토리(`/data`) 쓰기 및 인프라 조작 위험이 존재하던 설계 누락 발견.
- **조치**:
  1. 권한 정책 재정의: `WORKSPACE`에 프로젝트 개발 필수 권한인 **Git(status, diff, commit, push, branch)**을 공식 허용하고, `FULL_ACCESS`는 SSH/Docker 소켓 등 위험 인프라 전용으로 명확히 격리.
  2. 텔레그램 UI (`/profile`, `/help`) 및 양대 어댑터(`antigravity-adapter.js`, `codex-adapter.js`) 프롬프트 가드레일 동기화.
  3. Antigravity에 Codex와 동일한 Docker 샌드박스 물리 격리(`executeRestrictedPrompt`) 적용 및 단위 테스트 추가 완료.

## 6. 다음 작업 시작점

새 채팅에서 후속 개발을 시작할 때의 기준점은 다음과 같다.

```text
V1 Released
Phase 0 ~ 11: DONE
Phase 12: SKIPPED / SUPERSEDED
Phase 13: DONE — Mobile Preview Runtime & Preview Manager
Phase 14: DONE — /system System & Resource Observability
Phase 15: SKIPPED / UNASSIGNED
Phase 16: DONE — Canonical Compact / Model Thinking / Provider Usage·Quota 완료
Phase 17: DONE — NestJS/OpenAPI Backend API Preview & Inspector 완료
Phase 18: DONE — V2 Native Session Compact & Rollover 완료
Phase 19: DONE — MCP & Skills 완료
Phase 20: PLANNED — Coolify Deploy Integration & Voice Prompting (STT)
Phase 21: PLANNED — V2 LTS Final Hardening & Optimization (Feature Freeze)
Development root: /home/dev
Git repositories: /home/dev/workspace
```

V1 회귀가 발견되면 신규 Phase 진행보다 해당 결함 수정과 regression 추가를 우선한다.
