# Phase 5: Gemini Provider Integration

## 1. 목표

-   Gemini CLI를 Docker 환경에 고정 버전으로 추가한다.
-   실제 CLI Capability를 감사하고 `GeminiAdapter`를 구현한다.
-   Codex ↔ Gemini 양방향 Handoff를 실환경에서 검증한다.

## 2. 선행 조건

-   Phase 2 `DONE`.
-   Phase 4 `DONE`.

## 3. 세부 작업 항목

-   [ ] **Gemini CLI 설치 및 Pinning**
    -   정확한 버전으로 설치.
    -   `latest` 추적 금지.
    -   Auth/config persistence path를 확인하고
        `/data/providers/gemini/`와 연결.
-   [ ] **Gemini Capability Audit**
    -   Auth persistence.
    -   Non-interactive execution.
    -   Native session create/resume.
    -   Same-provider model switching.
    -   Dynamic model discovery.
    -   Usage/quota.
    -   Context/compact.
    -   Image/multi-image/file.
    -   Cancellation/exit code.
    -   Machine-readable output.
    -   Sandbox/approval.
    -   `.plan/CAPABILITIES_GEMINI.md` 기록.
-   [ ] **GeminiAdapter**
    -   `ProviderAdapter` 구현.
    -   실제 지원 기능만 `SUPPORTED`.
    -   미지원 기능을 하드코딩/Fallback으로 위장하지 않음.
-   [ ] **Model Discovery**
    -   Gemini CLI의 신뢰 가능한 discovery가 있을 때 동적 조회.
    -   없으면 `UNSUPPORTED`.
    -   모델 리스트 하드코딩 금지.
-   [ ] **Provider Manager 등록**
    -   `/providers`.
    -   `/model`.
    -   Health/Auth isolation.
-   [ ] **Codex ↔ Gemini Handoff**
    -   Codex → Gemini.
    -   Gemini → Codex.
    -   기존 Native Session 복귀 시 incremental sync.
    -   실패 rollback.

## 4. 생성 / 수정 대상 파일

-   `Dockerfile`
-   `.plan/CAPABILITIES_GEMINI.md`
-   `src/providers/gemini/gemini-adapter.js`
-   `src/providers/provider-manager.js`
-   `tests/integration/gemini-adapter.test.js`
-   `tests/integration/provider-handoff.test.js`

## 5. 테스트 / 검증 기준

-   [ ] Gemini 단독 질의 정상.
-   [ ] Gemini Auth data가 redeploy 후 유지.
-   [ ] Gemini 모델 목록 하드코딩 없음.
-   [ ] Codex → Gemini 문맥 연속성.
-   [ ] Gemini → Codex 증분 복귀.
-   [ ] Gemini 장애/인증 만료가 Codex/Core에 영향 없음.
-   [ ] Capability 문서가 실제 Pinning 버전 기준으로 작성됨.
