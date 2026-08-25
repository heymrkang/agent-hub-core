# Phase 7: Global Memory System

## 1. 목표

-   세션과 독립된 Markdown 기반 Global Memory를 구현한다.
-   변경 이력을 SQLite에 남긴다.
-   일반 Context/Handoff/Scheduler에서 관련 Memory를 사용할 수 있게
    한다.

## 2. 선행 조건

-   Phase 1 `DONE`.
-   Phase 4 `DONE`.

## 3. 세부 작업 항목

-   [ ] **Memory Files**
    -   `/data/memory/PROFILE.md`
    -   `/data/memory/GOALS.md`
    -   `/data/memory/CURRENT.md`
    -   `/data/memory/NOTES.md`
    -   Markdown 파일이 사람이 읽을 수 있는 Memory Source.
-   [ ] **Memory History**
    -   `memory_history`.
    -   file/diff/summary/source session/timestamp.
    -   Secret 저장 금지.
-   [ ] **Memory Manager**
    -   Read/write.
    -   Atomic write.
    -   동시성 보호.
    -   변경 이력.
    -   사소한 대화를 매번 Memory로 승격하지 않는다.
-   [ ] **Agent Update Policy**
    -   지속적으로 유효한 정보만 업데이트.
    -   자동 변경 시 Audit Trail 필수.
    -   사용자가 `/memory`에서 직접 수정/삭제 가능.
-   [ ] **Context Integration**
    -   Phase 4의 optional Memory hook을 실제 구현으로 연결.
    -   모든 Memory 파일 전체를 매 Prompt에 무조건 주입하지 않는다.
    -   관련 Memory 선택/요약 전략을 사용하되 원문 파일은 보존.
-   [ ] **Scheduler Integration**
    -   Phase 8의 isolated temporary execution context에서도 관련 Global
        Memory를 읽을 수 있도록 API 제공.
-   [ ] **`/memory`**
    -   목록.
    -   보기.
    -   편집.
    -   삭제/정리.
    -   최근 변경 이력.

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/005_memory.sql`
-   `src/memory/memory-manager.js`
-   `src/memory/memory-selector.js`
-   `src/context/context-manager.js`
-   `src/context/handoff-manager.js`
-   `src/telegram/commands/memory.js`

## 5. 테스트 / 검증 기준

-   [ ] Unit: Atomic write + history.
-   [ ] `/memory` 수정 후 실제 Markdown 반영.
-   [ ] 새 Session에서 관련 Memory 사용 가능.
-   [ ] Handoff package에 관련 Memory가 연결됨.
-   [ ] Container restart/redeploy 후 Memory/History 유지.
-   [ ] Casual message가 무분별하게 Memory를 오염시키지 않음.
