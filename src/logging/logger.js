import { getDb } from '../database/index.js';
import { redactSecrets } from '../utils/redact.js';

const LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);
const CATEGORIES = new Set(['app', 'provider', 'scheduler', 'backup', 'system', 'error']);

export class Logger {
  static log({ level = 'INFO', category = 'app', event, sessionId = null, provider = null, model = null, durationMs = null, errorCode = null, detail = null }) {
    if (!event) return;
    const safeLevel = LEVELS.has(String(level).toUpperCase()) ? String(level).toUpperCase() : 'INFO';
    const safeCategory = CATEGORIES.has(category) ? category : 'app';
    const safeEvent = redactSecrets(String(event)).slice(0, 200);
    const safeDetail = detail == null ? null : redactSecrets(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 4000);
    try {
      getDb().prepare(`INSERT INTO structured_logs(level,category,event,session_id,provider,model,duration_ms,error_code,detail) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(safeLevel, safeCategory, safeEvent, sessionId, provider, model, durationMs, errorCode, safeDetail);
    } catch (error) {
      console.warn(`[Logger] structured log 저장 실패: ${redactSecrets(error.message)}`);
    }
  }

  static info(category, event, detail = null, meta = {}) { this.log({ level: 'INFO', category, event, detail, ...meta }); }
  static warn(category, event, detail = null, meta = {}) { this.log({ level: 'WARN', category, event, detail, ...meta }); }
  static error(category, event, detail = null, meta = {}) { this.log({ level: 'ERROR', category, event, detail, ...meta }); }
}
