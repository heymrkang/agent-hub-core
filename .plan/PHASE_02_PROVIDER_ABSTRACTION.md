# Phase 2: Provider Abstraction & Dynamic Model Discovery

## 1. 목표

-   공통 `ProviderAdapter`와 Provider Manager를 구축한다.
-   기존 Codex 연동을 Adapter 구조로 이동한다.
-   모델/기능을 하드코딩하지 않고 Capability 기반으로 노출한다.
-   `/model`, `/providers`와 세션 자동 제목 생성을 구현한다.

## 2. 선행 조건

-   Phase 1 `DONE`.
-   Codex Capability Baseline 존재.

## 3. 세부 작업 항목

-   [ ] **ProviderAdapter Contract**
    -   `checkHealth()`
    -   `checkAuth()`
    -   `getVersion()`
    -   `discoverModels()`
    -   `getCapabilities()`
    -   `createSession()`
    -   `resumeSession()`
    -   `executePrompt()`
    -   `changeModel()`
    -   `compact()`
    -   `getUsage()`
    -   `attachFiles()`
    -   `stop()`
    -   정확한 코드 Signature는 구현에 맞게 조정 가능.
-   [ ] **Capability State**
    -   `SUPPORTED`
    -   `PARTIAL`
    -   `UNSUPPORTED`
    -   Provider가 지원하지 않는 기능을 성공처럼 가장하지 않는다.
-   [ ] **CodexAdapter**
    -   기존 정상 Codex 실행 경로를 Adapter로 이동.
    -   Auth data를 `/data/providers/codex/`에 영속화.
    -   Native session ref를 추후 DB와 연결할 수 있도록 인터페이스 준비.
-   [ ] **Dynamic Model Discovery**
    -   CLI가 공식적/신뢰 가능한 model discovery를 제공할 때만 파싱.
    -   Machine-readable output 우선.
    -   인터랙티브 TUI를 취약하게 scraping하여 모델 목록을 꾸며내지
        않는다.
    -   Discovery가 없으면 `UNSUPPORTED`로 표시하고 Provider가 허용하는
        안전한 입력 방식만 별도 설계한다.
    -   모델명 하드코딩 금지.
    -   Cache는 가능하되 Refresh 제공.
-   [ ] **Provider Manager**
    -   Adapter 등록/조회.
    -   Health/Auth/Capability/Model cache 관리.
    -   Provider 장애 격리.
-   [ ] **`/model`**
    -   1 Depth: Provider.
    -   2 Depth: 해당 Provider에서 발견된 Model.
    -   같은 Provider의 Model 변경은 Native Session 유지가 가능하면
        Native 방식 사용.
    -   Provider 변경은 Phase 4 Handoff 전까지 실제 전환 기능을
        제한/명시.
-   [ ] **`/providers`**
    -   CLI version.
    -   Health.
    -   Auth state.
    -   Capability.
    -   Model refresh.
-   [ ] **자동 세션 제목**
    -   첫 번째 성공적인 대화 후 한 번만 제목 생성.
    -   사용자가 `/rename`한 `title_locked` 세션은 자동 변경 금지.
    -   `/settings`에서 ON/OFF 연결은 Phase 10에서 완성.

## 4. 생성 / 수정 대상 파일

-   `src/providers/provider-adapter.js`
-   `src/providers/provider-manager.js`
-   `src/providers/codex/codex-adapter.js`
-   `src/telegram/commands/model.js`
-   `src/telegram/commands/providers.js`
-   `src/sessions/title-service.js`

## 5. 테스트 / 검증 기준

-   [ ] Unit: Capability mapping.
-   [ ] Integration: CodexAdapter 기본 Prompt.
-   [ ] Integration: Model discovery 결과가 CLI 실제 결과와 일치.
-   [ ] Discovery 미지원 상황에서 하드코딩 없이 `UNSUPPORTED` 처리.
-   [ ] Model 변경 후 DB `active_model` 동기화.
-   [ ] 첫 성공 대화 후 자동 제목 1회 생성 및 rename lock 보호.
-   [ ] Provider 장애가 Core를 죽이지 않음.
