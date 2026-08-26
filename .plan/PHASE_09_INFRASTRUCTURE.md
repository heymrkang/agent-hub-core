# Phase 9: Infrastructure Integrations --- SSH, Docker & Git

## 1. 목표

- SSH Key 기반 Host Registry와 Agent가 실제 사용할 수 있는 SSH 환경을 구축한다.
- Host Docker Socket과 Docker CLI를 함께 제공한다.
- Git/GitHub 인증 및 persistent workspace를 제공하여 Agent가 실제 repository를 clone/pull/edit/commit/push할 수 있게 한다.
- Execution Profile을 Provider Native sandbox/approval과 인프라 접근에 매핑한다.

## 2. 선행 조건

- Phase 1 `DONE`.
- Phase 3 `DONE`.

## 3. 세부 작업 항목

### 3.1 SSH Registry

- [ ] `ssh_hosts`.
- [ ] Host/Alias/Port/User/Identity file/enabled.
- [ ] Private Key 내용 SQLite 저장 금지.
- [ ] Registry 삭제 시 Physical Key 삭제 금지.

### 3.2 SSH Persistent Layout

- [ ] `/data/ssh/keys/`
- [ ] `/data/ssh/config`
- [ ] `/data/ssh/known_hosts`
- [ ] Key는 사용자가 persistent volume에 직접 배치.

### 3.3 실제 OpenSSH 적용

- [ ] Agent CLI가 기본 `ssh alias`로 사용할 수 있게 `/root/.ssh` 또는 실행 사용자의 `~/.ssh`와 `/data/ssh`를 명확히 연결.
- [ ] Symlink/bind mount/config option 중 구현 환경에 가장 안전한 방식 선택.
- [ ] Private key permission `0600`, SSH directory 적절한 permission 검증.
- [ ] `StrictHostKeyChecking=no`를 전역 편법으로 사용하지 않는다.
- [ ] `known_hosts`를 영속 관리.

### 3.4 `/servers`

- [ ] 목록.
- [ ] 추가/수정.
- [ ] disable/remove registry.
- [ ] `/data/ssh/keys` 파일 선택.
- [ ] SSH handshake/connectivity test.
- [ ] 실패 원인을 안전하게 표시.

### 3.5 Docker

- [ ] `/var/run/docker.sock` mount.
- [ ] **Docker CLI도 컨테이너에 설치/사용 가능해야 함.**
- [ ] Socket만 존재하는 상태를 완료로 간주하지 않는다.
- [ ] Docker daemon connectivity.
- [ ] `/status`용 summary API/module.

### 3.6 Git / GitHub Workspace Integration

- [ ] Container image에 Git CLI가 설치되어 있고 `git --version`이 정상 동작하는지 검증한다.
- [ ] GitHub CLI(`gh`)를 설치하여 GitHub HTTPS 인증과 향후 repository 관련 작업에 사용할 수 있게 한다.
- [ ] Agent 작업 repository의 기본 root를 `/workspace/repos`로 정한다.
- [ ] `/workspace/repos`는 container redeploy/restart 후에도 repository가 유지되도록 persistent volume으로 구성한다.
- [ ] Agent는 repository 작업 시 명시적인 working directory 아래에서만 Git 명령을 실행한다.
- [ ] Coolify Secret/Environment를 통한 GitHub 인증을 지원한다.
    - 우선 지원 환경변수: `GH_TOKEN`.
    - 필요 시 호환 목적으로 `GITHUB_TOKEN`을 지원할 수 있다.
    - Token 값은 SQLite, Telegram 메시지, application log, session memory에 저장하지 않는다.
    - Token을 clone URL(`https://TOKEN@github.com/...`)에 삽입하지 않는다.
    - Token이 `.git/config` remote URL에 기록되는 구조를 사용하지 않는다.
- [ ] GitHub CLI credential integration(`gh auth setup-git` 또는 동등하게 안전한 credential helper)을 사용하여 일반 `git clone/pull/fetch/push`가 인증된 상태로 동작하게 한다.
- [ ] Container startup 시 token 자체를 출력하지 않고 Git/GitHub 인증 가능 여부만 안전하게 진단할 수 있게 한다.
- [ ] 인증이 없는 경우 public repository Git 작업은 가능한 범위에서 허용하되 private repository 접근은 명확하게 실패시킨다. 인증 실패를 임의 fallback으로 우회하지 않는다.
- [ ] 기본 Git workflow를 Agent가 사용할 수 있게 한다.
    - `git clone`
    - `git fetch`
    - `git pull`
    - `git status`
    - `git diff`
    - `git add`
    - `git commit`
    - `git push`
- [ ] Agent가 commit/push 작업 전 현재 repository, branch, `git status`, 변경 diff를 확인하는 것을 기본 원칙으로 한다.
- [ ] Default branch 이름을 `main` 등으로 임의 추정하지 않고 repository의 실제 branch/upstream 정보를 사용한다.
- [ ] 기존 local 변경이 존재할 때 자동으로 덮어쓰거나 삭제하지 않는다.
- [ ] `git reset --hard`, `git clean -fd`, force push 등 destructive Git 명령은 V1 기본 자동 workflow에서 사용하지 않는다. 사용자가 명시적으로 요구하는 경우에도 현재 변경 상태를 먼저 확인한다.
- [ ] Git 명령 stdout/stderr에 Secret이 포함될 가능성이 있는 경우 기존 Secret Redaction 계층을 적용한다.
- [ ] GitHub Token은 Core Backup 대상에서 제외한다. Coolify Secret/Environment에서 별도로 관리한다.
- [ ] V1에서는 별도 GitHub API abstraction을 과도하게 만들지 않는다. 실제 Agent 작업은 표준 `git`/`gh` CLI를 우선 사용한다.
- [ ] `/repos` Telegram 관리 UI는 Phase 9 필수 범위에 포함하지 않는다. 필요 시 후속 Phase/Backlog에서 추가한다.

### 3.7 Execution Profile

- [ ] `READ_ONLY`
- [ ] `WORKSPACE`
- [ ] `FULL_ACCESS`
- [ ] Codex/Gemini Native sandbox/approval capability와 가능한 범위에서 매핑.
- [ ] V1에서 복잡한 자체 Command ACL 엔진은 만들지 않는다.
- [ ] Docker Socket은 강력한 권한임을 문서화.
- [ ] Git write operation(commit/push 등)은 Execution Profile 및 Provider native approval 정책과 충돌하지 않도록 매핑한다.

## 4. 생성 / 수정 대상 파일

- `src/database/migrations/007_ssh_hosts.sql`
- `src/ssh/ssh-manager.js`
- `src/ssh/config-generator.js`
- `src/docker/docker-client.js`
- `src/telegram/commands/servers.js`
- `src/git/git-manager.js` 또는 동등한 최소 integration module
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`

## 5. 테스트 / 검증 기준

### SSH / Docker

- [ ] SSH key permission 검증.
- [ ] `/servers` 등록 후 `ssh alias-name` 실제 연결.
- [ ] Container restart 후 config/known_hosts 유지.
- [ ] Registry 삭제 후 private key file 유지.
- [ ] Container 내부 `docker version`/`docker ps`가 허용 환경에서 동작.
- [ ] Docker Socket 장애가 Core 전체를 unhealthy로 만들지 않음.
- [ ] `/status`에 SSH/Docker 상태 제공 가능.

### Git / GitHub

- [ ] Container 내부 `git --version` 및 `gh --version` 정상.
- [ ] Token 미설정 상태에서 Secret 없이 안전하게 인증 미설정 상태를 진단.
- [ ] Coolify에 `GH_TOKEN` 설정 후 private repository 인증 확인.
- [ ] Token이 log/DB/Telegram/`.git/config` remote URL에 노출되지 않음을 확인.
- [ ] `/workspace/repos`에 repository clone 성공.
- [ ] Repository에서 fetch/pull/status/diff 정상.
- [ ] 테스트 변경 → add → commit → push E2E 성공.
- [ ] Container restart/redeploy 후 cloned repository 유지.
- [ ] 실제 remote/default branch 정보를 사용하고 `main`을 강제 가정하지 않음.
- [ ] 기존 uncommitted 변경이 있을 때 Agent가 이를 감지하고 보존.
- [ ] 인증 실패/권한 부족 시 destructive fallback 없이 명확하게 실패.
