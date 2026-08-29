# Phase 5: Antigravity Provider Integration & Codex ↔ Antigravity Handoff

## 1. 목적

Google Antigravity CLI(`agy`)를 Agent Hub Core V1의 두 번째 Provider로 완벽하게 통합한다.
Codex와 Antigravity 간 상호 Context Handoff 및 브라우저 구글 계정 OAuth 로그인 세션 영속화를 검증한다.

## 2. 핵심 원칙

1.  **공식 Binary 배포 사용**: `install.sh` 스크립트를 통해 `agy` 바이너리를 설치하고 버전을 점검한다.
2.  **인증 영속화**: `~/.gemini` 세션 디렉토리를 `/data/providers/antigravity`에 매핑하여 컨테이너 재배포 시에도 로그인 상태를 유지한다.
3.  **Transactional Handoff**: Codex ↔ Antigravity 간 전환 시 안전한 트랜잭션 Handoff 및 실패 시 자동 롤백을 보장한다.

## 3. 세부 작업 항목

-   [x] **Antigravity CLI Baseline & Capability Audit**
    -   `agy` 바이너리 설치 스크립트 Dockerfile 반영 및 `.plan/CAPABILITIES_ANTIGRAVITY.md` 작성.
-   [x] **AntigravityAdapter**
    -   `src/providers/antigravity/antigravity-adapter.js` 구현.
    -   비대화형 실행 (`-p`, `--skip-trust`, `-y`), 모델 매핑, 타임아웃, 중단 핸들링.
-   [x] **Auth & Config Persistence**
    -   `~/.gemini` 세션 디렉토리와 `/data/providers/antigravity/` 영속 볼륨 연동.
-   [x] **ProviderManager 등록**
    -   `src/providers/provider-manager.js`에 `AntigravityAdapter` 등록.
-   [x] **Codex ↔ Antigravity Handoff**
    -   `/model` 명령어를 통해 Codex와 Antigravity 간 모델/프로바이더 전환 지원.
    -   Handoff 트랜잭션 및 실패 시 자동 롤백.
