# Phase 4: Context Management & Provider Handoff

## 1. 목표

-   SQLite Canonical Context와 Provider Native Context를 분리한다.
-   Rolling Summary/Working Context를 구축한다.
-   Native Compact와 Agent Hub Summary를 명확히 구분한다.
-   Transactional + Incremental Provider Handoff를 구현한다.

## 2. 선행 조건

-   Phase 3 `DONE`.

## 3. 세부 작업 항목

-   [ ] **Canonical Context**
    -   원본 `messages`가 Source of Truth.
    -   `rolling_summary`, `working_context`는 보조 컨텍스트.
    -   Summary 갱신이 원본 Message 삭제를 의미하지 않음.
-   [ ] **Provider Native Sessions**
    -   `provider_sessions`: session/provider/native ref/last sync.
    -   한 Agent Hub Session이 여러 Provider Native Session을 가질 수
        있음.
-   [ ] **Provider Handoff History**
    -   `provider_handoffs`.
    -   from/to/status/timestamp.
    -   Handoff payload 저장 시 Secret/과도한 원문 중복에 주의.
-   [ ] **Native Compact**
    -   `/compact`는 Provider가 Native Compact를 지원할 때 해당 기능
        호출.
    -   실제 Before/After 수치가 Provider에서 제공될 때만 표시.
    -   미지원이면 `UNSUPPORTED`를 명확히 알린다.
    -   **Agent Hub Rolling Summary를 Native Compact인 것처럼 자동
        Fallback하지 않는다.**
-   [ ] **Agent Hub Summary**
    -   Rolling Summary는 Canonical Context 최적화/Handoff를 위한 별도
        기능.
    -   Native Compact와 Capability/상태를 분리.
-   [ ] **Auto Compact**
    -   Context usage를 Provider가 신뢰 가능하게 노출할 때만 percentage
        threshold 사용.
    -   임의 token estimate로 Provider context percentage를 가장하지
        않는다.
    -   설정 연결은 Phase 10에서 완성.
-   [ ] **Transactional Handoff**
    -   Handoff Package: Rolling Summary + Working Context + Recent
        Messages + Attachment metadata + **optional Memory hook**.
    -   Global Memory는 Phase 7 전까지 optional/no-op.
    -   대상 Provider Native Session 준비 및 context injection 성공
        확인.
    -   성공 후에만 `active_provider` 변경.
    -   실패 시 기존 Provider/Session 유지.
-   [ ] **Incremental Handoff**
    -   `Codex → Gemini → Codex` 복귀 시 기존 Codex Native Session
        재사용이 안전하면 재사용.
    -   `last_synced_message_id` 이후 변경점만 전달.
    -   Native Session reuse가 불안전/미지원이면 새 Native Session +
        full handoff.

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/003_context_and_handoff.sql`
-   `src/context/context-manager.js`
-   `src/context/summary-manager.js`
-   `src/context/compactor.js`
-   `src/context/handoff-manager.js`
-   `src/telegram/commands/compact.js`

## 5. 테스트 / 검증 기준

-   [ ] Unit: Handoff package 구성.
-   [ ] Integration: Handoff 실패 시 `active_provider` 불변.
-   [ ] Integration: Handoff 성공 후에만 전환.
-   [ ] Compact 후 Canonical Message 전부 보존.
-   [ ] Native Compact 미지원 Provider에서 가짜 성공/가짜 metric 없음.
-   [ ] Incremental Handoff sync point 검증.
-   [ ] Phase 7 이전 Memory hook이 없어도 Handoff 정상 동작.
