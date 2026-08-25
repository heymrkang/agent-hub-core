# Phase 4: Context Management & Provider Handoff

## 1. 목표

-   SQLite Canonical Context와 Provider Native Context를 분리한다.
-   Rolling Summary/Working Context를 구축한다.
-   Native Compact와 Agent Hub Summary를 명확히 구분한다.
-   Transactional + Incremental Provider Handoff를 구현한다.

## 2. 선행 조건

-   Phase 3 `DONE`.

## 3. 세부 작업 항목

-   [x] **Canonical Context**
    -   `src/context/context-manager.js`: SQLite 원본 `messages`가 단일 진실 공급원(Source of Truth).
    -   `rolling_summary`, `working_context` 보조 필드 지원.
-   [x] **Provider Native Sessions**
    -   `003_context_and_handoff.sql`: `provider_sessions` 테이블 생성 및 세션별 native session ref, last synced message id 추적.
-   [x] **Provider Handoff History**
    -   `provider_handoffs` 테이블 생성 (`from_provider`, `to_provider`, `status`, `handoff_payload`).
-   [x] **Native Compact**
    -   `src/context/compactor.js`: `/compact` 호출 시 Provider Native Compact 실행. 미지원 시 `UNSUPPORTED` 명확히 보고 (가짜 fallback 배제).
-   [x] **Transactional Handoff**
    -   `src/context/handoff-manager.js`: 대상 어댑터 헬스체크 -> Handoff 패키지 구성 -> DB 트랜잭션 내 `active_provider` 전환 및 Handoff 상태 기록. 실패 시 자동 롤백.
-   [x] **Incremental Handoff**
    -   기존 네이티브 세션 존재 시 `last_synced_message_id` 이후의 변경점만 추출하여 증분 전달.

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
