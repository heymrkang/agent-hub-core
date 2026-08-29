# Phase 0: Baseline Audit & Environment Setup

## 1. 목표

-   기존 코드베이스와 현재 정상 동작 중인 Telegram → Codex 경로를 정확히
    파악한다.
-   Codex CLI 버전을 확인하고 Dockerfile에 고정한다.
-   `/data` 영속 볼륨 구조와 환경 변수를 표준화한다.
-   이후 구현이 추측에 의존하지 않도록 Codex CLI Capability Baseline을
    기록한다.

## 2. 선행 조건

-   `Dockerfile`, `package.json`, `docker-compose.yml`, 현재 `src/` 확인
    가능.
-   현재 Telegram → Codex 기본 질의가 동작하는 상태를 가능한 한
    보존한다.

## 3. 세부 작업 항목

-   [x] **현재 코드 감사**
    -   `src/codex.js`: CLI 실행 방식, 인자, stdin/stdout/stderr, timeout/cancel 처리 분석 완료.
    -   `src/telegram.js`: Bot 초기화, 인증, 메시지 분할 처리 흐름 분석 완료.
    -   `src/index.js`: Startup 및 lifecycle 분석 완료.
    -   현재 정상 동작 경로 문서화 및 베이스라인 확보.
-   [x] **CLI 버전 고정**
    -   Codex CLI 버전 확인 (`0.149.1`).
    -   Dockerfile에서 `@openai/codex@0.149.1`로 Pinning 완료.
-   [x] **Codex Capability Audit**
    -   Auth persistence, Non-interactive execution, JSON output, Session resume, Model specify, Sandbox/Approval, Multi-image 등 실측 완료.
    -   결과를 `.plan/CAPABILITIES_CODEX.md`에 기록 완료.
    -   미지원/부분지원 기능(`UNSUPPORTED`, `PARTIAL`) 분류 완료.
-   [x] **영속 `/data` 표준 구조**
    -   `/data/providers/codex`, `/data/providers/gemini`, `/data/memory`, `/data/ssh/keys`, `/data/uploads`, `/data/logs`, `/data/backups/{core,full,migrations}` 표준 디렉토리 반영.
    -   `docker-compose.yml` 마운트 구조를 `./data:/data` 단일 영속 루트로 수렴.
-   [x] **환경 변수**
    -   `.env.example` 업데이트 (`DATA_DIR=/data`, `TELEGRAM_ADMIN_USER_ID`, `TELEGRAM_BOT_TOKEN`, `CODEX_TIMEOUT_MS`).
    -   단일 소유자 인증 규격 적용.

## 4. 생성 / 수정 대상 파일

-   `Dockerfile`
-   `docker-compose.yml`
-   `.env.example`
-   `.plan/CAPABILITIES_CODEX.md`
-   `.plan/PHASE_00_BASELINE_AUDIT.md`

## 5. 테스트 / 검증 기준

-   [ ] Docker Build 성공.
-   [ ] 컨테이너 내부 Codex 버전이 Pinning 값과 동일.
-   [ ] `/data` Mount 후 컨테이너 재생성에도 테스트 파일 유지.
-   [ ] 기존 Telegram → Codex 기본 질의 회귀 테스트 통과.
-   [ ] Capability Audit 결과가 실제 CLI 실행 결과에 기반하여 문서화됨.
-   [ ] 완료 후 애플리케이션 정상 기동.
