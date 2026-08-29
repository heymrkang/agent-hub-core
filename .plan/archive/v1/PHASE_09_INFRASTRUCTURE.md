# Phase 9: Infrastructure Integrations --- SSH, Docker & Git

## Status

`DONE` — 2026-08-27

Phase 9 구현 및 Coolify runtime E2E 검증을 완료했다. SSH, Host Docker, Git/GitHub, persistent workspace와 Execution Profile의 핵심 동작이 실제 배포 환경에서 검증되었다.

## 1. 목표

- [x] SSH Key 기반 Host Registry와 Agent가 실제 사용할 수 있는 SSH 환경을 구축한다.
- [x] Host Docker Socket과 Docker CLI를 함께 제공한다.
- [x] Git/GitHub 인증 및 persistent workspace를 제공하여 Agent가 실제 repository를 clone/pull/edit/commit/push할 수 있게 한다.
- [x] Execution Profile을 배포 환경에서 실제 강제 가능한 권한 경계로 제공한다.

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
- [x] `READ_ONLY`: short-lived sibling Docker helper에서 `/workspace`를 read-only mount하여 filesystem write를 실제 차단.
- [x] `WORKSPACE`: short-lived sibling Docker helper에서 `/workspace`만 read-write mount하여 개발 작업 허용.
- [x] Restricted helper에는 Docker socket, SSH key, GH/GitHub token, 전체 `/data`를 전달하지 않으며 `--cap-drop ALL` + `no-new-privileges`를 적용.
- [x] `FULL_ACCESS`: 명시적 Codex full-access 실행으로 SSH/Docker/Git 인프라 작업 허용.
- [x] Sandbox 실패 시 FULL_ACCESS로 자동 승격하지 않음.
- [x] Antigravity: native equivalent sandbox가 없어 `PARTIAL` capability로 명시.
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

## 5. Runtime 검증 결과

- [x] Redeploy 시 migration `v9: infrastructure` 적용 성공.
- [x] Startup 로그에서 SSH persistent config 준비 완료.
- [x] Startup 로그에서 `git`, `gh` 존재 및 GitHub auth `READY` 확인.
- [x] Host Docker daemon 연결 및 실제 container inventory 조회 성공.
- [x] `/profile`에서 READ_ONLY / WORKSPACE / FULL_ACCESS 전환 확인.
- [x] READ_ONLY에서 `/workspace/read-only-test.txt` 생성 시 `Read-only file system`으로 실제 차단 확인.
- [x] WORKSPACE에서 `/workspace/workspace-test.txt` 생성 및 `PHASE9 WORKSPACE TEST` 내용/22 bytes 검증 성공.
- [x] FULL_ACCESS에서 Host Docker container 조회 성공.
- [x] `/servers add dev ...` Registry 생성 및 활성화 성공.
- [x] `/servers test dev` 실제 SSH 연결 성공.
- [x] Agent가 `ssh dev`로 원격 hostname `DietPi` 조회 성공.
- [x] Agent가 `ssh dev`를 통해 원격 `docker ps` 실행 성공.
- [x] GitHub Fine-grained PAT 인증 `READY` 확인.
- [x] Private repository clone/status/branch/remote/pull 성공.
- [x] `08S6 Test Git token push` commit 및 `origin/main` push 성공.
- [x] Coolify redeploy 후 `/workspace/repos/agent-hub-core`와 `.git`, README 변경 내용 유지 확인.
- [x] Agent가 persisted repository의 `git status`와 최근 commit history 조회 성공.

## 6. 최종 판정

**PHASE 9 — DONE**

2026-08-27 실제 Coolify 배포 환경에서 핵심 E2E를 완료했다. 초기 Codex `bwrap`/Landlock 충돌은 restricted profile을 short-lived sibling Docker isolation boundary로 재설계하여 해결했고, READ_ONLY의 실제 write 차단과 WORKSPACE의 실제 write 성공을 모두 검증했다.
