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

-   [x] **Attachments Migration**
    -   `004_attachments.sql`: `session_id`, `message_id`, `media_group_id`, `file_name`, `file_type`, `local_path`, `sha256`, `metadata`.
-   [x] **Attachment Manager**
    -   `src/attachments/attachment-manager.js`: Telegram 파일 다운로드, `/data/uploads/YYYY-MM/` 영속화, SHA256 해시 계산.
-   [x] **Media Group Debounce Buffer**
    -   `src/attachments/media-group-buffer.js`: Telegram 앨범/다중 전송 시 500ms 디바운스로 단일 작업 묶음 처리.
-   [x] **Provider Multi-Image / File Injection**
    -   `src/telegram.js`: `[첨부 파일 목록]` 및 파일 경로를 프롬프트에 자동 주입하여 Codex / Antigravity 모두 분석 가능하도록 연동.
-   [x] **파일 다운로드 명령어**
    -   `src/telegram/commands/files.js`: `/files` (세션 첨부 파일 조회), `/download <filename>` (안전한 파일 다운로드 및 Path Traversal 방어).
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
