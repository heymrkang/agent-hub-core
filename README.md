# Agent Hub Core V1

Telegram을 중심으로 Codex CLI와 Antigravity CLI를 실행하고, 세션·메모리·스케줄러·Git/SSH/Docker 작업을 하나의 persistent runtime에서 관리하는 개인용 Agent Hub입니다.

> 현재 Phase 11 release verification 진행 중입니다. 코드가 동작한다고 해서 검증되지 않은 항목을 V1 release 완료로 표시하지 않습니다.

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

Dockerfile 기준 provider CLI는 Codex `0.149.1`, Antigravity `1.1.20`으로 고정되어 있습니다. 버전을 올릴 때는 Dockerfile의 버전과 Antigravity archive checksum을 함께 갱신하고 Phase 11 regression을 다시 통과시켜야 합니다.

## Required persistent mounts

Coolify/Docker 재배포 후에도 상태를 유지하려면 다음 경로를 persistent storage에 연결합니다.

```text
/data           -> Agent Hub SQLite, backup, SSH registry, uploads, logs
/workspace      -> Agent 작업 workspace / repositories
/root/.codex    -> Codex authentication state
/root/.gemini   -> Antigravity authentication state
```

Docker 기능을 사용할 경우 추가로 host socket을 연결합니다.

```text
/var/run/docker.sock -> /var/run/docker.sock
```

`docker.sock`은 host Docker daemon에 강한 권한을 제공하므로 신뢰할 수 있는 Agent Hub container에만 mount해야 합니다.

SSH private key는 repository나 환경변수에 넣지 않고 `/data/ssh/keys` 아래에 직접 배치합니다. 해당 디렉토리는 private key 보호를 위해 제한된 권한으로 생성됩니다.

## Environment

`.env.example`을 기준으로 구성합니다. 실제 secret은 Git에 commit하지 말고 Coolify Secret/Environment에서 관리합니다.

주요 값:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_USER_ID
CODEX_TIMEOUT_MS
ANTIGRAVITY_TIMEOUT_MS
CODEX_CONCURRENCY
ANTIGRAVITY_CONCURRENCY
DATA_DIR=/data
WORKSPACE_DIR=/workspace
REPOS_ROOT=/workspace/repos
SSH_DATA_DIR=/data/ssh
GH_TOKEN
GIT_USER_NAME
GIT_USER_EMAIL
DOCKER_HOST=unix:///var/run/docker.sock
```

`TELEGRAM_ADMIN_USER_ID`가 없으면 Telegram 요청은 fail-closed 방식으로 차단됩니다.

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

GitHub CLI 인증은 `GH_TOKEN`을 우선 사용합니다. Git commit identity는 명시적으로 지정해야 하며 Agent Hub가 임의 값을 만들지 않습니다.

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

Full Backup은 `/data`와 `/workspace`를 archive하되 다음 민감/재귀 항목을 제외합니다.

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

Phase 11 automated E2E는 빈 target으로 Core snapshot을 복사한 뒤 DB integrity와 대표 Session/Settings/Memory/Schedule 데이터를 검증합니다. 최종 release gate에서는 Coolify 실제 restore/redeploy도 별도로 확인합니다.

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

현재 suite는 Telegram authorization, WAL-safe pre-migration snapshot, DB schema version guard, restart interruption recovery, redeploy persistence, Core backup restore를 자동 검증합니다. 실제 Telegram/provider/Coolify 전체 lifecycle은 외부 credential과 runtime이 필요하므로 별도 live release gate로 유지합니다.

## Deploy / redeploy checklist

1. persistent mounts가 기존 storage를 가리키는지 확인
2. 동일 Telegram Bot Token으로 polling하는 container가 하나뿐인지 확인
3. deploy 후 container health가 `Healthy`인지 확인
4. `/status`에서 Core health 확인
5. Codex와 Antigravity 각각 짧은 요청 1회 확인
6. `/backup status`에서 최근 Core Backup 확인

Telegram에서 다음 오류가 계속 반복되면 같은 bot token을 사용하는 polling instance가 둘 이상 존재하는지 먼저 확인합니다.

```text
409 Conflict: terminated by other getUpdates request
```
