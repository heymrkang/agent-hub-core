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
-   [x] **Gemini CLI Baseline & Capability Audit**
    -   `@google/gemini-cli@0.56.0` 고정 및 `.plan/CAPABILITIES_GEMINI.md` 작성.
-   [x] **GeminiAdapter**
    -   `src/providers/gemini/gemini-adapter.js` 구현.
    -   비대화형 실행 (`-p`, `--approval-mode yolo`, `--skip-trust`, `-o text`), 모델 매핑, 타임아웃, 중단 핸들링.
-   [x] **Auth & Config Persistence**
    -   `GEMINI_API_KEY` 환경변수 지원 및 `/data/providers/gemini/` 영속 볼륨 연동.
-   [x] **ProviderManager 등록**
    -   `src/providers/provider-manager.js`에 `GeminiAdapter` 기본 등록.
-   [x] **Codex ↔ Gemini Handoff 검증**
    -   `/model` 명령어를 통해 Codex와 Gemini 간 모델/프로바이더 전환 지원.
    -   Handoff 트랜잭션 및 실패 시 자동 롤백.

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
