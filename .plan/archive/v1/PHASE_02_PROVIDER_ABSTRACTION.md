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

-   [x] **ProviderAdapter Contract**
    -   `checkHealth()`, `checkAuth()`, `discoverModels()`, `getCapabilities()`, `executePrompt()`, `compact()`, `getUsage()`.
    -   `src/providers/provider-adapter.js`에 공통 추상 클래스 정의.
-   [x] **Capability State**
    -   `SUPPORTED`, `PARTIAL`, `UNSUPPORTED` 표준 매핑 준수.
-   [x] **CodexAdapter**
    -   `src/providers/codex/codex-adapter.js` 구현.
    -   비대화형 실행, 샌드박스 바이패스, 모델 옵션, 에러/타임아웃 핸들링.
-   [x] **Dynamic Model Discovery**
    -   `codex doctor --json` 진단 리포트 파싱 및 지원 모델 동적 조회.
    -   캐싱 및 강제 새로고침(Refresh) 지원.
-   [x] **Provider Manager**
    -   `src/providers/provider-manager.js`: Provider 인스턴스 등록/조회 및 상태 통합 조회 (`getProvidersStatus`).
-   [x] **`/model`**
    -   `src/telegram/commands/model.js`: 1단계 Provider 선택 -> 2단계 Dynamic Model 인라인 버튼 선택 및 세션 `active_model` 동기화.
-   [x] **`/providers`**
    -   `src/telegram/commands/providers.js`: CLI 버전, 헬스, 인증 상태, 주요 기능 지원 상태 및 새로고침 UI.
-   [x] **자동 세션 제목**
    -   `src/sessions/title-service.js`: 첫 대화 성공 후 1회 자동 제목 생성 (`title_locked = 0` 일 때만 동작).

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
