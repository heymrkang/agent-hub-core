# Phase 9: Infrastructure Integrations --- SSH & Docker

## 1. 목표

-   SSH Key 기반 Host Registry와 Agent가 실제 사용할 수 있는 SSH 환경을
    구축한다.
-   Host Docker Socket과 Docker CLI를 함께 제공한다.
-   Execution Profile을 Provider Native sandbox/approval과 인프라 접근에
    매핑한다.

## 2. 선행 조건

-   Phase 1 `DONE`.
-   Phase 3 `DONE`.

## 3. 세부 작업 항목

-   [ ] **SSH Registry**
    -   `ssh_hosts`.
    -   Host/Alias/Port/User/Identity file/enabled.
    -   Private Key 내용 SQLite 저장 금지.
    -   Registry 삭제 시 Physical Key 삭제 금지.
-   [ ] **SSH Persistent Layout**
    -   `/data/ssh/keys/`
    -   `/data/ssh/config`
    -   `/data/ssh/known_hosts`
    -   Key는 사용자가 persistent volume에 직접 배치.
-   [ ] **실제 OpenSSH 적용**
    -   Agent CLI가 기본 `ssh alias`로 사용할 수 있게 `/root/.ssh` 또는
        실행 사용자의 `~/.ssh`와 `/data/ssh`를 명확히 연결.
    -   Symlink/bind mount/config option 중 구현 환경에 가장 안전한 방식
        선택.
    -   Private key permission `0600`, SSH directory 적절한 permission
        검증.
    -   `StrictHostKeyChecking=no`를 전역 편법으로 사용하지 않는다.
    -   `known_hosts`를 영속 관리.
-   [ ] **`/servers`**
    -   목록.
    -   추가/수정.
    -   disable/remove registry.
    -   `/data/ssh/keys` 파일 선택.
    -   SSH handshake/connectivity test.
    -   실패 원인을 안전하게 표시.
-   [ ] **Docker**
    -   `/var/run/docker.sock` mount.
    -   **Docker CLI도 컨테이너에 설치/사용 가능해야 함.**
    -   Socket만 존재하는 상태를 완료로 간주하지 않는다.
    -   Docker daemon connectivity.
    -   `/status`용 summary API/module.
-   [ ] **Execution Profile**
    -   `READ_ONLY`
    -   `WORKSPACE`
    -   `FULL_ACCESS`
    -   Codex/Gemini Native sandbox/approval capability와 가능한
        범위에서 매핑.
    -   V1에서 복잡한 자체 Command ACL 엔진은 만들지 않는다.
    -   Docker Socket은 강력한 권한임을 문서화.

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/007_ssh_hosts.sql`
-   `src/ssh/ssh-manager.js`
-   `src/ssh/config-generator.js`
-   `src/docker/docker-client.js`
-   `src/telegram/commands/servers.js`
-   `Dockerfile`
-   `docker-compose.yml`

## 5. 테스트 / 검증 기준

-   [ ] SSH key permission 검증.
-   [ ] `/servers` 등록 후 `ssh alias-name` 실제 연결.
-   [ ] Container restart 후 config/known_hosts 유지.
-   [ ] Registry 삭제 후 private key file 유지.
-   [ ] Container 내부 `docker version`/`docker ps`가 허용 환경에서
    동작.
-   [ ] Docker Socket 장애가 Core 전체를 unhealthy로 만들지 않음.
-   [ ] `/status`에 SSH/Docker 상태 제공 가능.
