# Agent Hub Core V2

Telegram을 중심으로 Codex CLI와 Antigravity CLI를 실행하고, Logical Session·Provider native conversation·장기 메모리·스케줄러·Git/SSH/Docker 작업을 하나의 persistent runtime에서 관리하는 개인용 Agent Hub입니다.

> **Current release: 2.0.0 (Path to V2 LTS).** V1 → V2 Native Session Bridge, Next.js/NestJS 모바일 프리뷰, V2 세션 롤오버, MCP & Skills 전역 듀얼 싱크를 완료했습니다. 현재 모바일 배포/음성 연동(Phase 20) 및 최종 최적화·보안 감사(Phase 21)를 거쳐 **V2 LTS 공식 릴리즈 및 기능 개발 영구 동결(Feature Freeze)**을 향해 진행 중입니다.

## V2 LTS Release & Feature Freeze Roadmap

Agent Hub Core는 모바일 환경에서의 완벽한 1인 바이브코딩 인프라 구축을 목표로 하며, Phase 21을 기점으로 신규 기능 개발을 공식 영구 동결(Feature Freeze)하고 최종 장기 지원 버전(V2 LTS)으로 완성됩니다. 이후에는 Core 기능 개발을 종료하고 실전 사이드 프로젝트 개발에 전념합니다.

```text
Phase 13~19: DONE (Next.js/NestJS 모바일 프리뷰, V2 Compact 롤오버, MCP & Skills 전역 듀얼 싱크)
      ↓
Phase 20: PLANNED (Coolify Deploy Webhook & Whisper Voice Prompting)
      ↓
Phase 21: PLANNED (V2 LTS Final Hardening & Optimization)
  • 토큰 다이어트: 턴당 시스템 프롬프트 및 가드레일 토큰 낭비 전면 차단
  • 레거시 정리: V2 Native 구조와 불일치하거나 미사용 명령어 전수 점검 및 최적화
  • Public Repo 보안 감사: 하드코딩 식별자(GIT_NAME, GIT_EMAIL 등) 전면 환경변수화 (.env.example)
  • 전체 회귀 테스트 100% 올그린 & v2.0.0-lts 공식 태깅
      ↓
🚀 Agent Hub Core Feature Freeze & 실전 사이드 프로젝트 바이브코딩 전념
```

## V2 Architecture

V2의 핵심 원칙은 **Agent Hub가 Provider의 대화를 재구성해 소유하지 않고, Provider native conversation을 연결하고 중계하는 것**입니다.

```text
Agent Hub Logical Session A
├─ Codex native thread A
└─ Antigravity native conversation A
```

- `/sessions`는 항상 Agent Hub Logical Session을 선택합니다.
- `/model`은 현재 Logical Session 안에서 Provider만 전환합니다.
- same-provider turn은 기존 Provider native session을 resume합니다.
- cross-provider return은 상대 Provider가 놓친 delta만 전달합니다.
- `/new`는 Logical Session을 만들고 Provider native session은 첫 실행 때 lazy bind합니다.
- native resume 실패를 조용히 새 blank session으로 대체하지 않습니다.

Global Memory도 V2에서는 매 turn prompt에 붙이지 않습니다.

```text
/data/memory/MEMORY.md             = Agent Hub canonical memory
/root/.codex/AGENTS.md             = Codex native Rules mirror
/root/.gemini/GEMINI.md            = Antigravity native Rules mirror
```

Agent Hub는 Provider Rules 파일 전체를 덮어쓰지 않고 `AGENT_HUB_MEMORY_START/END` marker 사이만 관리합니다. `/memory` 변경과 startup 시 두 Provider Rules를 canonical memory에서 동기화합니다.

상세한 migration/validation 기록은 `.plan/V1_V2_NATIVE_SESSION_BRIDGE.md`를 참고합니다.

## Runtime

- Node.js 20 / SQLite (`better-sqlite3`)
- Telegram Bot polling
- OpenAI Codex CLI
- Antigravity CLI (`agy`)
- Internal Scheduler
- Git + GitHub CLI
- SSH client
- Docker socket integration
- Internal health endpoint: `http://127.0.0.1:8787/health`

Dockerfile 기준 provider CLI는 Codex `0.149.1`, Antigravity `1.1.20`으로 고정되어 있습니다. 버전을 올릴 때는 Dockerfile의 버전과 Antigravity archive checksum을 함께 갱신하고 regression을 다시 통과시켜야 합니다.

## Required persistent mounts

Coolify/Docker 재배포 후에도 상태를 유지하려면 다음 경로를 persistent storage에 연결합니다.

```text
/data           -> Agent Hub SQLite, backup, SSH registry, uploads, logs, canonical memory
/home/dev       -> Agent의 persistent development root
/root/.codex    -> Codex authentication, native sessions, AGENTS.md
/root/.gemini   -> Antigravity authentication, native conversations, GEMINI.md
```

`/home/dev/workspace`는 Git repository를 두는 기본 영역이며, notes/ideas/docs/scripts 등 다른 개발 자료도 `/home/dev` 아래에 둘 수 있습니다. Linux의 `/dev`는 device namespace이므로 일반 persistent volume으로 덮어쓰지 않습니다.

Docker 기능을 사용할 경우 추가로 host socket을 연결합니다.

```text
/var/run/docker.sock -> /var/run/docker.sock
```

`docker.sock`은 host Docker daemon에 강한 권한을 제공하므로 신뢰할 수 있는 Agent Hub container에만 mount해야 합니다.

SSH private key는 repository나 환경변수에 넣지 않고 `/data/ssh/keys` 아래에 직접 배치합니다. 해당 디렉토리는 private key 보호를 위해 제한된 권한으로 생성됩니다.

## Environment

이 절을 환경변수의 기준 문서로 사용합니다. 실제 secret은 Git에 commit하지 말고 Coolify Secret/Environment에서 관리합니다. Coolify 값을 바꾼 뒤에는 container를 재배포해야 새 값이 적용됩니다.

환경변수를 추가·삭제·변경할 때는 코드, `docker-compose.yml`, `.env.example`, 아래 표를 같은 commit에서 함께 갱신합니다. 키 이름, 기본값, 단위, 허용 범위 또는 필수 여부 중 하나라도 바뀌면 이 절도 반드시 수정합니다.

### 필수 값과 인증

| 키 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | 예 | 없음 | Telegram BotFather가 발급한 bot token. 없으면 시작에 실패합니다. |
| `TELEGRAM_ALLOWED_USER_IDS` | 예 (Compose) | 없음 | 허용할 Telegram 숫자 user ID. 여러 명은 쉼표로 구분합니다. Coolify Compose에서 누락 시 배포에 실패합니다. |
| `TELEGRAM_ADMIN_USER_ID` | 아니요 | 없음 | 이전 키와의 호환용 별칭. 코드에서는 이 값이 `TELEGRAM_ALLOWED_USER_IDS`보다 우선합니다. 신규 배포는 `TELEGRAM_ALLOWED_USER_IDS`를 사용합니다. 두 키가 모두 없으면 모든 요청을 차단합니다. |
| `PREVIEW_INTERNAL_TOKEN` | 예 (Compose) | 없음 | Core의 Preview route API와 Preview Gateway 사이의 내부 Bearer token. `openssl rand -hex 32` 등으로 생성하고 두 service에 같은 값을 전달합니다. Coolify Compose에서 누락 시 배포에 실패합니다. |
| `GH_TOKEN` | 현재 Compose에서 필수 | 없음 | GitHub CLI 인증 token. 로그에서 redaction하며 Coolify secret으로 관리합니다. |
| `GITHUB_TOKEN` | 아니요 | 없음 | `GH_TOKEN`이 없을 때만 사용하는 호환용 GitHub token 별칭입니다. |
| `GIT_USER_NAME` | Git commit 시 필요 | 없음 | Agent가 만드는 Git commit의 전역 `user.name`입니다. |
| `GIT_USER_EMAIL` | Git commit 시 필요 | 없음 | Agent가 만드는 Git commit의 전역 `user.email`입니다. |

현재 Compose는 `GIT_USER_NAME`과 `GIT_USER_EMAIL`을 literal 값으로 전달합니다. Coolify 환경변수로 바꾸려면 Compose의 두 항목도 `${GIT_USER_NAME:?...}` / `${GIT_USER_EMAIL:?...}` 형태로 바꿔야 합니다.

### 실행 및 스케줄러 조절값

아래 값은 미설정 또는 빈 문자열이면 기본값을 사용합니다. 값을 명시한 경우에는 표의 범위에 맞는 10진수 정수여야 하며, 문자·소수·0·음수·안전 정수 범위 초과 값이면 애플리케이션 시작을 중단합니다.

| 키 | 기본값 | 단위/범위 | 설명 |
| --- | ---: | --- | --- |
| `CODEX_TIMEOUT_MS` | `120000` | ms, 1 이상 | Codex 작업 1회의 기본 실행 제한 시간입니다. |
| `ANTIGRAVITY_TIMEOUT_MS` | `120000` | ms, 1 이상 | Antigravity 작업 1회의 기본 실행 제한 시간입니다. |
| `ANTIGRAVITY_MODEL_DISCOVERY_TIMEOUT_MS` | `60000` | ms, 1 이상 | `agy models`를 이용한 모델 목록 조회 제한 시간입니다. |
| `EXECUTION_TAIL_SIZE` | `3` | DB message 수, 1 이상 | legacy bootstrap/recovery context에 사용하는 직전 원문 메시지 수입니다. Provider native session이 READY인 same-provider normal turn에는 canonical history를 재구성하지 않습니다. |
| `CODEX_CONCURRENCY` | `2` | 동시 job 수, 1 이상 | Codex provider 전역 동시 실행 수입니다. |
| `ANTIGRAVITY_CONCURRENCY` | `2` | 동시 job 수, 1 이상 | Antigravity provider 전역 동시 실행 수입니다. |
| `MODEL_REFRESH_INTERVAL_SECONDS` | `21600` | 초, 3600 이상 | Provider model catalog 자동 갱신 간격입니다. 기본값은 6시간입니다. |
| `SCHEDULER_QUEUE_GRACE_SECONDS` | `30` | 초, 1 이상 | 예약 작업이 provider queue에서 실행 시작을 기다리는 유예 시간입니다. |

Telegram `/settings`에 provider concurrency가 저장돼 있으면 DB 설정값이 `CODEX_CONCURRENCY` 또는 `ANTIGRAVITY_CONCURRENCY`보다 우선합니다.

### 저장소와 외부 도구

| 키 | 코드 기본값 | 현재 Compose 값 | 설명 |
| --- | --- | --- | --- |
| `DATA_DIR` | 실행 위치의 `data` 또는 `/data` | `/data` | SQLite, backup, log, attachment, canonical memory 등 영속 데이터의 root입니다. 운영에서는 persistent volume이 필요합니다. |
| `WORKSPACE_DIR` | 대부분 `/home/dev`, 일부 보조 기능 `/workspace` | `/home/dev` | Provider 실행과 full backup이 사용하는 개발 root입니다. 운영에서는 항상 명시합니다. |
| `DEVELOPMENT_ROOT` | `/home/dev/workspace` | 미지정 | Preview가 프로젝트 경로를 탐색할 때 사용하는 Git repository root입니다. 일반적으로 `REPOS_ROOT`와 같은 경로를 사용합니다. |
| `REPOS_ROOT` | `/home/dev/workspace` | `/home/dev/workspace` | Git repository 생성·조회 기준 경로입니다. |
| `SSH_DATA_DIR` | `/data/ssh` | `/data/ssh` | SSH host registry와 key directory의 root입니다. |
| `DOCKER_HOST` | `unix:///var/run/docker.sock` | 미지정 | 연결할 Docker daemon socket입니다. 미지정 시 같은 기본 socket을 사용합니다. |
| `TZ` | `Asia/Seoul` | `Asia/Seoul` | Scheduler와 표시 시간에 사용하는 기본 timezone입니다. |

`DATA_DIR`, `WORKSPACE_DIR`, `REPOS_ROOT`, `SSH_DATA_DIR`를 바꾸면 Compose volume mount 경로도 함께 맞춰야 합니다. 환경변수만 바꾸고 mount를 그대로 두면 데이터가 영속 storage 밖에 기록될 수 있습니다.

### Preview와 내부 Health

| 키 | 코드 기본값 | 적용 service | 설명 |
| --- | --- | --- | --- |
| `PREVIEW_DOMAIN` | `12190529.xyz` | Core | 생성되는 `preview-<slug>-<id>.<domain>` hostname의 base domain입니다. scheme과 path 없이 입력합니다. |
| `PREVIEW_NODE_IMAGE` | `node:22-bookworm-slim` | Core | 격리 Preview container에 사용하는 Node image입니다. |
| `PREVIEW_DOCKER_NETWORK` | `agent-hub-preview` | Core | Preview container를 연결할 Docker network 이름입니다. Agent Hub 관리 label이 붙은 network여야 합니다. |
| `PREVIEW_ROUTE_HOST` | `0.0.0.0` | Core | Preview route API bind 주소입니다. |
| `PREVIEW_ROUTE_PORT` | `8790` | Core | Preview route API port. 1~65535 정수만 허용합니다. |
| `PREVIEW_GATEWAY_HOST` | `0.0.0.0` | Gateway | Preview Gateway bind 주소입니다. |
| `PREVIEW_GATEWAY_PORT` | `8080` | Gateway | Preview Gateway port. 1~65535 정수만 허용합니다. |
| `PREVIEW_ROUTE_API` | `http://agent-telegram:8790` | Gateway | Gateway가 조회할 Core Preview route API의 내부 URL입니다. |
| `PREVIEW_GATEWAY_ACCESS_LOG` | 비활성 | Gateway | 문자열 `true`일 때만 요청 access log를 활성화합니다. |
| `PREVIEW_TUNNEL_ONLY` | `false` | Core | `true`일 때만 Backend API Preview의 Cloudflare Access 검증을 시도합니다. |
| `PREVIEW_CLOUDFLARE_TEAM_DOMAIN` | 없음 | Core | `https://<team>.cloudflareaccess.com` 형식의 Access team domain입니다. |
| `PREVIEW_CLOUDFLARE_ACCESS_AUD` | 없음 | Core | Backend API Preview를 보호하는 Access application audience입니다. 실제 값은 Coolify secret으로만 둡니다. |
| `HEALTH_HOST` | `127.0.0.1` | Core | 내부 health server bind 주소입니다. |
| `HEALTH_PORT` | `8787` | Core | 내부 health server port입니다. |

현재 `docker-compose.yml`은 Preview 내부 token, Gateway 설정과 Access 검증 설정을 service에 명시적으로 전달합니다.

Backend API Preview는 Access 설정값만으로 공개 승인하지 않습니다. 생성 hostname에서 실제 Cloudflare Access challenge를 확인하고, 환경 파일 격리 label까지 확인된 경우에만 Gateway route를 엽니다. 프로젝트 루트에 `.env.preview`가 있으면 그 파일만 container 환경 변수로 주입하고, 없으면 환경 변수 없이 정상 실행합니다. `.env`, `.env.local`, monorepo의 다른 환경 파일은 container에서 마스킹합니다. DB 종류와 변수 이름은 프로젝트가 정하며 Agent Hub가 MariaDB, MongoDB, Redis 등을 구분하지 않습니다.

Phase 17 실제 서버 검증은 Telegram, Access, OpenAPI, 개발 MariaDB CRUD, 재시작, cleanup, 기존 Web Preview를 확인한 뒤 해당 `PHASE17_*_OK=1` evidence만 일회성 shell에 주입해 `npm run test:phase17:live`로 닫습니다. 이 값들은 기능을 우회하는 설정이 아니라 수동 확인 결과를 누락 없이 모으는 release gate입니다.

### 런타임이 관리하는 값

`HOME`, `HOSTNAME`, `NODE_OPTIONS`는 container/runtime 동작에 필요한 값이라 일반 운영 튜닝 대상으로 보지 않습니다. `PHASE11_LIVE_E2E`는 외부 인증이 필요한 live E2E를 명시적으로 실행할 때만 쓰는 테스트 플래그입니다.

## Execution Profiles

- `READ_ONLY`: `/home/dev`를 읽기 전용으로 제공하며 파일 생성/수정을 차단합니다.
- `WORKSPACE`: `/home/dev` 전체에서 일반 개발 작업을 위한 읽기/쓰기를 허용합니다.
- `FULL_ACCESS`: `/home/dev` 작업에 더해 SSH/Docker/Git 등 인프라 접근을 허용합니다.

Codex의 READ_ONLY/WORKSPACE는 short-lived restricted helper container에서 immutable root filesystem과 `/home/dev`의 `ro`/`rw` mount로 강제합니다. Restricted helper에는 Docker socket, SSH private key, GitHub token 또는 전체 `/data`를 전달하지 않습니다.

## Provider login

Provider 인증은 Agent Hub DB가 아니라 각 CLI의 native auth state를 사용합니다.

Codex는 container shell에서 한 번 로그인합니다.

```bash
codex login
```

Antigravity는 container shell에서 `agy`를 대화형으로 실행하고 Google 로그인을 완료합니다.

```bash
agy
```

로그인 이후 `/root/.codex`, `/root/.gemini`가 persistent mount되어 있어야 redeploy 뒤에도 CLI 정책이 허용하는 범위에서 인증 상태와 native conversation/rules가 유지됩니다.

## Memory

```text
/memory
/memory <내용>
/memory add <내용>
/memory set <전체 내용>
/memory clear
```

`/memory`의 source of truth는 `/data/memory/MEMORY.md`입니다. mutation이 성공하면 Codex `AGENTS.md`와 Antigravity `GEMINI.md`의 Agent Hub managed block도 함께 동기화됩니다. Provider rules write가 부분 실패하면 가능한 범위에서 rollback하고 명령을 실패로 노출합니다.

## Git / GitHub

GitHub CLI 인증은 `GH_TOKEN`을 우선 사용합니다. Git commit identity는 명시적으로 지정해야 하며 Agent Hub가 임의 값을 만들지 않습니다. 기본 repository root는 `/home/dev/workspace`입니다.

```text
GH_TOKEN=<secret>
GIT_USER_NAME=<name>
GIT_USER_EMAIL=<email>
```

## SSH

Private key를 예를 들어 다음 위치에 배치합니다.

```text
/data/ssh/keys/dev.key
```

그 후 Telegram `/servers`에서 host alias를 등록하고 test합니다. 현재 운영 정책은 key authentication을 기준으로 합니다.

## Backup

Telegram에서 다음 명령을 사용할 수 있습니다.

```text
/backup status
/backup core
/backup full
/backup list
```

Core Backup은 SQLite의 일관된 snapshot을 생성하고 `PRAGMA quick_check`로 검증합니다. 자동 Core Backup은 최신 7개를 유지합니다.

Full Backup은 `/data`와 현재 `WORKSPACE_DIR`(`/home/dev`)을 archive하되 다음 민감/재귀 항목을 제외합니다.

```text
/data/ssh/keys
/data/logs
/data/backups
/data/agent-hub.db-wal
/data/agent-hub.db-shm
```

SSH private key는 backup에 포함되지 않는 것이 정책입니다.

### Core Backup restore rehearsal

실제 운영 DB를 덮어쓰기 전에 반드시 별도 빈 target에서 검증합니다.

1. Agent Hub container를 중지합니다.
2. 복구하려는 `core_*.db` 파일을 별도 빈 `/data` 환경의 `agent-hub.db`로 복사합니다.
3. 복원 DB에서 `PRAGMA quick_check`가 `ok`인지 확인합니다.
4. container를 시작하고 schema migration/startup이 정상인지 확인합니다.
5. Session, Settings, Memory, Schedule이 복원됐는지 확인합니다.
6. SSH private key와 provider auth state는 Core DB backup 대상이 아니므로 persistent mounts에서 별도로 존재해야 합니다.

Phase 11 automated E2E는 빈 target으로 Core snapshot을 복사한 뒤 DB integrity와 대표 Session/Settings/Memory/Schedule 데이터를 검증합니다.

## Health

Container 내부 health endpoint:

```text
GET http://127.0.0.1:8787/health
```

Dockerfile에도 동일 endpoint를 사용하는 HEALTHCHECK가 포함되어 있습니다. Telegram `/status`에서는 DB, Scheduler, Provider, model catalog, Docker, Git/GitHub, SSH, Storage, Jobs 상태를 함께 확인할 수 있습니다.

## Regression tests

Node.js 내장 `node:test`를 사용합니다.

```bash
npm test
```

Suite는 Telegram authorization, WAL-safe pre-migration snapshot, DB schema version guard, restart interruption recovery, redeploy persistence, Core backup restore, queue concurrency, Logical Session-first routing, Provider native session bridge, Provider Rules memory sync 등을 자동 검증합니다. 실제 Telegram/provider/Coolify 전체 lifecycle은 외부 credential과 runtime이 필요하므로 live verification으로 별도 확인합니다.

## Deploy / redeploy checklist

1. `/data`, `/home/dev`, `/root/.codex`, `/root/.gemini` persistent mounts가 기존 storage를 가리키는지 확인
2. Linux device namespace `/dev`를 일반 storage mount로 덮어쓰지 않았는지 확인
3. 동일 Telegram Bot Token으로 polling하는 container가 하나뿐인지 확인
4. deploy 후 container health가 `Healthy`인지 확인
5. startup banner가 `Agent Hub Core V2 · 2.0.0`인지 확인
6. `/status`에서 Core health 확인
7. `/sessions`에서 Logical Session과 Provider native mapping 상태 확인
8. Codex와 Antigravity 각각 짧은 continuation 요청 1회 확인
9. `/memory` mirror 상태 확인
10. `/backup status`에서 최근 Core Backup 확인

Telegram에서 다음 오류가 계속 반복되면 같은 bot token을 사용하는 polling instance가 둘 이상 존재하는지 먼저 확인합니다.

```text
409 Conflict: terminated by other getUpdates request
```
