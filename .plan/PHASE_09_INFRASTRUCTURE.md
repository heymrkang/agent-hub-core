# Phase 9: Infrastructure Integrations --- SSH, Docker & Git

## Status

`IMPLEMENTED / READY_FOR_RUNTIME_TEST` — 2026-08-27

Phase 9 코드 구현은 완료했다. Migration v9, Docker image 변경, Coolify/host socket 및 실제 SSH/GitHub 인증이 필요한 항목은 Redeploy 후 runtime E2E 검증을 거쳐 `DONE` 처리한다.

## 1. 목표

- [x] SSH Key 기반 Host Registry와 Agent가 실제 사용할 수 있는 SSH 환경을 구축한다.
- [x] Host Docker Socket과 Docker CLI를 함께 제공한다.
- [x] Git/GitHub 인증 및 persistent workspace를 제공하여 Agent가 실제 repository를 clone/pull/edit/commit/push할 수 있게 한다.
- [x] Execution Profile을 Provider Native sandbox/approval과 인프라 접근에 가능한 범위에서 매핑한다.

## 2. 구현 완료 항목

### SSH

- [x] `ssh_hosts` SQLite Registry (`009_infrastructure.sql`).
- [x] Host/Alias/Port/User/Identity file/enabled 관리.
- [x] Private Key 내용 SQLite 저장 금지.
- [x] Registry 삭제 시 Physical Key 삭제 금지.
- [x] `/data/ssh/keys`, `/data/ssh/config`, `/data/ssh/known_hosts` persistent layout.
- [x] `/root/.ssh/config`, `known_hosts`를 persistent `/data/ssh`에 연결.
- [x] Private Key `0600`, SSH directory `0700` permission 보정.
- [x] `StrictHostKeyChecking accept-new` + persistent `known_hosts`; 전역 `no` 사용 안 함.
- [x] `/servers` 목록/추가/수정/disable/remove/test 및 Key 파일 discovery.
- [x] `ssh alias` 형태의 실제 OpenSSH 호출 경로.

### Docker

- [x] Container image에 Docker CLI 설치.
- [x] Compose에 `/var/run/docker.sock` mount 정의.
- [x] Docker daemon connectivity summary module.
- [x] Docker socket/daemon 장애는 Core startup을 중단하지 않고 degraded warning만 기록.
- [x] Phase 10 `/status`에서 재사용 가능한 Docker summary API.

### Git / GitHub

- [x] Container image에 `git`, `gh` CLI 설치 및 build-time version check.
- [x] `/workspace/repos` persistent repository root.
- [x] Coolify Secret/Environment `GH_TOKEN` 우선, `GITHUB_TOKEN` compatibility fallback.
- [x] Token을 clone URL/SQLite/application log에 명시적으로 저장하지 않는 구조.
- [x] `gh auth setup-git` 기반 HTTPS credential helper bootstrap.
- [x] `GIT_USER_NAME`, `GIT_USER_EMAIL` 환경변수 기반 commit identity.
- [x] Git startup/auth status diagnostics에서 token 값 비출력.
- [x] Agent가 표준 `git clone/fetch/pull/status/diff/add/commit/push` CLI를 직접 사용할 수 있는 환경.
- [x] GitManager에 clone/repository inspection 및 secret redaction 경로 제공.
- [x] 실제 branch/upstream 확인 및 remote URL token redaction 지원.
- [x] `/repos` Telegram UI는 V1 Phase 9 필수 범위에서 제외.

### Execution Profile

- [x] Session profile: `READ_ONLY`, `WORKSPACE`, `FULL_ACCESS`.
- [x] `/profile` Telegram UI 및 session persistence.
- [x] Codex: READ_ONLY → native `read-only` sandbox, WORKSPACE → native `workspace-write`, FULL_ACCESS → explicit bypass/full access.
- [x] Antigravity: native equivalent sandbox가 없어 `PARTIAL` capability로 명시. READ_ONLY는 permission bypass 제거, WORKSPACE/FULL_ACCESS는 기존 non-interactive compatibility를 유지하며 profile guard를 전달.
- [x] FULL_ACCESS가 SSH/Docker 등 강력한 인프라 권한임을 UI에서 명시.

## 3. 운영 전제

- SSH Private Key는 사용자가 `/data/ssh/keys/` persistent volume에 직접 배치한다.
- GitHub Token 실제 값은 repository/.env에 commit하지 않고 Coolify Secret/Environment에만 설정한다.
- Docker socket mount는 사실상 host root 수준의 강력한 권한이므로 trusted single-owner deployment를 전제로 한다.
- Coolify에서 Dockerfile 직접 배포하여 `docker-compose.yml`의 volume 정의가 사용되지 않는 경우 `/var/run/docker.sock:/var/run/docker.sock` mount를 Coolify에서 별도로 추가해야 한다.
- `/workspace` 자체가 persistent volume이어야 `/workspace/repos` clone 결과가 redeploy 후 유지된다.

## 4. 생성 / 수정 파일

- `src/database/migrations/009_infrastructure.sql`
- `src/ssh/config-generator.js`
- `src/ssh/ssh-manager.js`
- `src/docker/docker-client.js`
- `src/git/git-manager.js`
- `src/telegram/commands/servers.js`
- `src/telegram/commands/profile.js`
- `src/sessions/session-manager.js`
- `src/providers/codex/codex-adapter.js`
- `src/providers/antigravity/antigravity-adapter.js`
- `src/index.js`
- `src/telegram.js`
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`

## 5. Runtime 검증 체크리스트

- [ ] Redeploy 시 migration `v9: infrastructure` 적용 성공.
- [ ] Startup 로그에서 SSH persistent config 준비 완료.
- [ ] Startup 로그에서 `git`, `gh` 존재 및 GitHub auth 상태 확인.
- [ ] Startup 로그에서 Docker daemon 연결 또는 안전한 degraded 상태 확인.
- [ ] Container 내부 `git --version`, `gh --version`, `docker version`, `ssh -V` 정상.
- [ ] `/profile`에서 READ_ONLY / WORKSPACE / FULL_ACCESS 전환 및 session persistence.
- [ ] Codex READ_ONLY에서 write 차단, WORKSPACE에서 `/workspace` write 가능, FULL_ACCESS에서 인프라 작업 가능.
- [ ] `/servers keys`에서 persistent Key discovery.
- [ ] `/servers add ...` 후 Registry 생성 및 `/data/ssh/config` 반영.
- [ ] `/servers test <alias>` 실제 SSH 연결 성공.
- [ ] Container restart 후 SSH config/known_hosts 유지.
- [ ] Registry 제거 후 private key file 유지.
- [ ] Host Docker socket mount 후 `docker ps` 정상.
- [ ] Docker socket 미존재/장애가 Core 전체를 unhealthy로 만들지 않음.
- [ ] Coolify `GH_TOKEN` 설정 후 private repository clone/pull 가능.
- [ ] Git token이 Telegram/log/`.git/config` remote URL에 노출되지 않음.
- [ ] `/workspace/repos` test repo 변경 → commit → push E2E 성공.
- [ ] Redeploy 후 cloned repository 유지.
- [ ] 기존 uncommitted 변경을 보존하고 destructive Git fallback을 수행하지 않음.

## 6. 최종 판정 기준

위 runtime 핵심 E2E가 통과하면 **PHASE 9 — DONE**으로 변경한다.
