# Phase 6: Multi-Attachment System

## 1. 목표

-   다중 이미지/다중 파일을 V1 기본 동작으로 구현한다.
-   Binary는 `/data/uploads`, Metadata는 SQLite에 저장한다.
-   Provider별 Native Attachment 방식과 Handoff를 연결한다.

## 2. 선행 조건

-   Phase 1 `DONE`.
-   Phase 3 `DONE`.
-   Phase 5까지 완료되어 Codex/Gemini Adapter 사용 가능.

## 3. 세부 작업 항목

-   [ ] **Attachment Schema**
    -   1 Message : N Attachments.
    -   `id`, `message_id`, `session_id`, `type`, `original_name`,
        `stored_path`, `mime_type`, `size`, `telegram_file_id`,
        `created_at`.
    -   Binary를 SQLite BLOB으로 저장하지 않는다.
-   [ ] **Storage**
    -   `/data/uploads/<session-id>/`.
    -   안전한 filename 생성.
    -   Path traversal 방지.
    -   다운로드 실패 시 partial file 정리.
-   [ ] **Telegram Multi-Attachment**
    -   Single image.
    -   Multiple images / Media Group.
    -   Documents.
    -   Text + attachments.
    -   Telegram Media Group의 여러 Update를 하나의 논리 Message로 묶는
        aggregation 처리.
-   [ ] **Provider Delivery**
    -   Image는 Provider Native image mechanism 우선.
    -   일반 File은 CLI가 접근 가능한 안전한 workspace/path로 전달.
    -   Provider Capability 미지원 시 명확한 오류.
    -   무리한 자동 변환 금지.
-   [ ] **Handoff**
    -   관련 Attachment metadata/path 포함.
    -   필요 Attachment만 선택적으로 재첨부.
    -   오래된 첨부는 Canonical Session Asset으로 유지.
-   [ ] **Lifecycle**
    -   Soft Delete 30일 동안 파일 유지.
    -   실제 영구 삭제는 Phase 10 Cleanup Job에서 수행.

## 4. 생성 / 수정 대상 파일

-   `src/database/migrations/004_attachments.sql`
-   `src/attachments/attachment-manager.js`
-   `src/attachments/storage.js`
-   `src/telegram/handlers/media-handler.js`
-   `src/providers/codex/codex-adapter.js`
-   `src/providers/gemini/gemini-adapter.js`

## 5. 테스트 / 검증 기준

-   [ ] Unit: 안전한 저장 경로/filename.
-   [ ] Integration: Telegram Media Group 여러 이미지가 하나의 논리
    Message에 1:N 저장.
-   [ ] Integration: Text + multiple attachments.
-   [ ] Codex/Gemini 이미지 인식 검증(지원 Provider).
-   [ ] Generic file 접근 검증.
-   [ ] Handoff 후 관련 Attachment 접근 가능.
-   [ ] Soft Delete 후 파일 유지.
