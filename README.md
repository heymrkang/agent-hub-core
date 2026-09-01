# Agent Hub Core V1

Telegram을 중심으로 Codex CLI와 Antigravity CLI를 실행하고, 세션·메모리·스케줄러·Git/SSH/Docker 작업을 하나의 persistent runtime에서 관리하는 개인용 Agent Hub입니다.

> Phase 11 hardening 및 release verification을 완료했으며 현재 V1 Released baseline입니다.

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
/data           -> Agent Hub SQLite, backup, SSH registry, uploads, logs
/home/dev       -> Agent의 persistent development root
/root/.codex    -> Codex authentication state
/root/.gemini   -> Antigravity authentication state
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
| `EXECUTION_TAIL_SIZE` | `3` | DB message 수, 1 이상 | 실행 prompt에 rolling summary와 함께 넣는 직전 원문 메시지 수입니다. 대화 쌍이나 턴 수가 아닙니다. 현재 사용자 요청은 별도로 조립되므로 여기에 중복 포함하지 않습니다. |
| `CODEX_CONCURRENCY` | `2` | 동시 job 수, 1 이상 | Codex provider 전역 동시 실행 수입니다. |
| `ANTIGRAVITY_CONCURRENCY` | `2` | 동시 job 수, 1 이상 | Antigravity provider 전역 동시 실행 수입니다. |
| `MODEL_REFRESH_INTERVAL_SECONDS` | `21600` | 초, 3600 이상 | Provider model catalog 자동 갱신 간격입니다. 기본값은 6시간입니다. |
| `SCHEDULER_QUEUE_GRACE_SECONDS` | `30` | 초, 1 이상 | 예약 작업이 provider queue에서 실행 시작을 기다리는 유예 시간입니다. |

Telegram `/settings`에 provider concurrency가 저장돼 있으면 DB 설정값이 `CODEX_CONCURRENCY` 또는 `ANTIGRAVITY_CONCURRENCY`보다 우선합니다.

### 저장소와 외부 도구

| 키 | 코드 기본값 | 현재 Compose 값 | 설명 |
| --- | --- | --- | --- |
| `DATA_DIR` | 실행 위치의 `data` 또는 `/data` | `/data` | SQLite, backup, log, attachment 등 영속 데이터의 root입니다. 운영에서는 persistent volume이 필요합니다. |
| `WORKSPACE_DIR` | 대부분 `/home/dev`, 일부 보조 기능 `/workspace` | `/home/dev` | Provider 실행과 full backup이 사용하는 개발 root입니다. 운영에서는 항상 명시합니다. |
| `DEVELOPMENT_ROOT` | `/home/dev` | 미지정 | Preview가 프로젝트 경로를 탐색할 때 사용하는 개발 root입니다. 일반적으로 `WORKSPACE_DIR`와 같은 경로를 사용합니다. |
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
| `HEALTH_HOST` | `127.0.0.1` | Core | 내부 health server bind 주소입니다. |
| `HEALTH_PORT` | `8787` | Core | 내부 health server port입니다. |

현재 `docker-compose.yml`에서 실제로 service에 전달하는 Preview 값은 `PREVIEW_INTERNAL_TOKEN`, Gateway의 `PREVIEW_ROUTE_API`, `PREVIEW_GATEWAY_HOST`, `PREVIEW_GATEWAY_PORT`입니다. 나머지를 Coolify에서 조절하려면 해당 키를 대상 service의 `environment`에도 추가해야 합니다. `.env.example`에 값을 적는 것만으로 container 내부에 자동 전달되지는 않습니다.

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

로그인 이후 `/root/.codex`, `/root/.gemini`가 persistent mount되어 있어야 redeploy 뒤에도 CLI 정책이 허용하는 범위에서 인증 상태가 유지됩니다.

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

그 후 Telegram `/servers`에서 host alias를 등록하고 test합니다. 비밀번호 SSH는 V1 범위가 아니며 key authentication만 사용합니다.

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

Suite는 Telegram authorization, WAL-safe pre-migration snapshot, DB schema version guard, restart interruption recovery, redeploy persistence, Core backup restore, queue concurrency 등을 자동 검증합니다. 실제 Telegram/provider/Coolify 전체 lifecycle은 외부 credential과 runtime이 필요하므로 live verification으로 별도 확인합니다.

## Deploy / redeploy checklist

1. `/data`, `/home/dev`, provider auth persistent mounts가 기존 storage를 가리키는지 확인
2. Linux device namespace `/dev`를 일반 storage mount로 덮어쓰지 않았는지 확인
3. 동일 Telegram Bot Token으로 polling하는 container가 하나뿐인지 확인
4. deploy 후 container health가 `Healthy`인지 확인
5. `/status`에서 Core health 확인
6. `/profile`에서 READ_ONLY/WORKSPACE/FULL_ACCESS 설명이 `/home/dev` 기준인지 확인
7. Codex와 Antigravity 각각 짧은 요청 1회 확인
8. `/backup status`에서 최근 Core Backup 확인

Telegram에서 다음 오류가 계속 반복되면 같은 bot token을 사용하는 polling instance가 둘 이상 존재하는지 먼저 확인합니다.

```text
409 Conflict: terminated by other getUpdates request
```
