# Agent Hub Core Project Plan

> **Status:** V1 Released\
> **Role:** 현행 아키텍처와 변경 불변 조건의 Source of Truth\
> **Current development root:** `/home/dev`\
> **Git repository root:** `/home/dev/workspace`

세부 완료 이력은 `archive/v1`, Phase 순서와 상태는 `ROADMAP.md`, 현재 구현 예정 범위는 각 Phase 문서에서 관리한다.

## 1. 제품 범위

Agent Hub Core는 Telegram을 기본 제어면으로 사용하는 개인용 Docker-first AI agent runtime이다. Codex CLI와 Antigravity CLI를 공통 실행 계층에 연결하고 다음 상태를 재시작과 재배포 뒤에도 유지한다.

- 대화 세션, 메시지, Provider handoff
- Global Memory와 첨부 파일
- Job queue와 내부 Scheduler
- 설정, 알림, backup, cleanup
- Git/GitHub, SSH, Host Docker 작업
- 실행 profile별 filesystem 및 인프라 권한 경계

별도 범용 Web UI나 공개 Agent Hub API는 현재 범위가 아니다.

## 2. Canonical architecture

```text
Telegram
   |
   v
Agent Hub Core
   |-- SQLite canonical store
   |-- Job Runtime / Session FIFO / Provider Queue
   |-- Context / Memory / Scheduler / Attachments
   |-- Codex Adapter ------> Codex CLI
   |-- Antigravity Adapter -> agy CLI
   `-- Git / SSH / Docker / Backup / Health
```

- SQLite 원본 메시지와 운영 상태가 canonical source of truth다.
- Provider native session은 실행 최적화 수단이며 canonical history를 대체하지 않는다.
- Provider 전환은 transactional handoff로 처리하고 실패하면 기존 Provider 상태를 유지한다.
- 동일 세션 작업은 FIFO, Provider 작업은 설정된 concurrency limit를 따른다.
- 실행 중 재시작된 Job은 `INTERRUPTED`로 기록하며 자동 재실행하지 않는다.

## 3. Persistent layout

```text
/data                 SQLite, backup, uploads, memory, logs, SSH registry
/home/dev             persistent development root
/home/dev/workspace   Git repository 기본 영역
/root/.codex          Codex native authentication state
/root/.gemini         Antigravity native authentication state
```

- Linux `/dev`는 device namespace이므로 persistent volume으로 덮어쓰지 않는다.
- SSH private key는 `/data/ssh/keys`에만 두고 DB, 로그, repository, 일반 backup에 넣지 않는다.
- `/var/run/docker.sock`은 `FULL_ACCESS`에서만 사용하는 강한 host 권한이다.

## 4. Provider rules

- Provider는 공통 adapter contract로 격리한다.
- 모델 목록과 기능은 설치된 CLI에서 discovery하고 cache한다.
- 모델 이름이나 지원 기능을 임의로 hardcode하거나 가짜 fallback으로 숨기지 않는다.
- capability는 `SUPPORTED`, `PARTIAL`, `UNSUPPORTED`로 명시한다.
- CLI 버전 변경 시 Dockerfile pin/checksum, capability baseline, regression을 함께 갱신한다.
- 한 Provider의 장애가 Core나 다른 Provider를 종료시키면 안 된다.

현재 고정 baseline은 `CAPABILITIES_CODEX.md`와 `CAPABILITIES_ANTIGRAVITY.md`를 따른다.

## 5. Context, memory, attachments

- 원본 대화는 SQLite에 보존하고 rolling summary와 working context는 보조 자료로만 사용한다.
- Provider handoff는 마지막 동기화 지점 이후 변경분을 우선 전달한다.
- Global Memory 원본은 `/data/memory/MEMORY.md`, 감사 기록은 파일과 SQLite에 남긴다.
- 첨부 binary는 `/data/uploads`, metadata는 SQLite에 저장한다.
- Telegram 전송용 분할/렌더링과 DB canonical response 저장을 분리한다.

## 6. Security and execution profiles

- Telegram owner 인증은 numeric user ID 기준이며 설정 누락 시 fail-closed다.
- `READ_ONLY`: `/home/dev` 읽기 전용, 인프라 credential과 Docker socket 미제공.
- `WORKSPACE`: `/home/dev` 읽기/쓰기, 인프라 credential과 Docker socket 미제공.
- `FULL_ACCESS`: 명시적으로 선택된 세션에 SSH, Docker, Git 인프라 기능 허용.
- Token, OAuth credential, API key, SSH private key는 로그와 DB에 기록하지 않는다.
- destructive host/Docker 동작은 관찰 기능의 묵시적 fallback으로 실행하지 않는다.

`WORKSPACE`는 profile 이름이며 과거 경로 `/workspace`를 뜻하지 않는다.

## 7. Operations and recovery

- `/data`, `/home/dev`, Provider auth 경로는 재배포 가능한 persistent mount로 유지한다.
- DB migration 직전 WAL-safe snapshot을 만들고, 알 수 없는 상위 schema version에서는 startup을 중단한다.
- Core Backup은 SQLite 일관성과 integrity를 검증하고 최근 7개를 보존한다.
- Full Backup은 SSH private key, 로그, backup 재귀, SQLite WAL/SHM을 제외한다.
- Scheduler는 one-shot isolated system session, overlap `SKIP`, retry 없음, missed-run replay 없음이 기본이다.
- 동일 Telegram Bot Token으로 polling하는 runtime은 하나만 둔다.
- 배포 뒤 container health와 Telegram `/status`를 확인한다.

구체적인 배포와 restore 절차는 repository `README.md`를 따른다.

## 8. Change rules

1. 합의되지 않은 기능은 구현하지 않고 해당 Phase의 decision 항목에 둔다.
2. 신규 기능은 V1 regression과 위 불변 조건을 깨지 않는 후속 Phase로 진행한다.
3. 구현과 합의된 아키텍처가 달라지면 코드와 이 문서를 같은 변경에서 갱신한다.
4. Phase 완료 시 테스트와 필요한 live runtime 검증을 수행하고 `ROADMAP.md` 상태를 갱신한다.
5. 완료 문서는 `archive`에 보존하며 현재 기준 문서로 재사용하지 않는다.

## 9. Current queue

- Phase 0~11: 완료
- Phase 12: 중복 범위로 스킵
- Phase 13: Mobile Preview Runtime & Preview Manager — 다음 작업
- Phase 14: System & Resource Observability — 계획

상세 범위는 `ROADMAP.md`, `PHASE_13_PREVIEW_MANAGER.md`, `PHASE_14_SYSTEM_RESOURCES.md`를 따른다.
