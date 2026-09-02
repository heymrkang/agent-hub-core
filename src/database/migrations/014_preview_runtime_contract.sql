-- 014_preview_runtime_contract.sql
-- Phase 17-0 Preview runtime/capability data contract

ALTER TABLE previews ADD COLUMN runtime_type TEXT NOT NULL DEFAULT 'WEB'
    CHECK (runtime_type IN ('WEB', 'BACKEND_API'));
ALTER TABLE previews ADD COLUMN framework TEXT
    CHECK (framework IS NULL OR framework IN ('NEXTJS', 'VITE', 'NESTJS'));
ALTER TABLE previews ADD COLUMN openapi_ui_path TEXT
    CHECK (openapi_ui_path IS NULL OR (substr(openapi_ui_path, 1, 1) = '/' AND substr(openapi_ui_path, 1, 2) <> '//'));
ALTER TABLE previews ADD COLUMN openapi_json_path TEXT
    CHECK (openapi_json_path IS NULL OR (substr(openapi_json_path, 1, 1) = '/' AND substr(openapi_json_path, 1, 2) <> '//'));
ALTER TABLE previews ADD COLUMN health_path TEXT
    CHECK (health_path IS NULL OR (substr(health_path, 1, 1) = '/' AND substr(health_path, 1, 2) <> '//'));
ALTER TABLE previews ADD COLUMN access_verified INTEGER NOT NULL DEFAULT 0
    CHECK (access_verified IN (0, 1));

-- Explicit backfill documents and guarantees the legacy Preview contract.
UPDATE previews
SET runtime_type = 'WEB', access_verified = 0
WHERE runtime_type IS NULL OR runtime_type = '';
