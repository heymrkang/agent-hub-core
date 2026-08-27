import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database/index.js';
import { BackupManager } from '../backup/backup-manager.js';
import { NotificationManager } from '../notifications/notification-manager.js';
import { Logger } from '../logging/logger.js';
import { redactSecrets } from '../utils/redact.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;

class SystemJobsImpl {
  constructor() { this.timer = null; this.ownerUserId = null; }
  start(ownerUserId = null) {
    if (this.timer) return;
    this.ownerUserId = ownerUserId;
    this.runDue().catch((e) => console.error(`[SystemJobs] 초기 실행 실패: ${e.message}`));
    this.timer = setInterval(() => this.runDue().catch((e) => console.error(`[SystemJobs] tick 실패: ${e.message}`)), 60 * 60 * 1000);
    console.log('[SystemJobs] Daily backup / 30-day cleanup 시작 완료.');
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  lastSuccess(name) { return getDb().prepare(`SELECT finished_at FROM system_job_runs WHERE job_name=? AND status='COMPLETED' ORDER BY started_at DESC LIMIT 1`).get(name)?.finished_at || null; }
  due(name, everyMs = DAY_MS) {
    const last = this.lastSuccess(name);
    if (!last) return true;
    const parsed = Date.parse(String(last).replace(' ', 'T') + 'Z');
    return !Number.isFinite(parsed) || Date.now() - parsed >= everyMs;
  }

  async runRecorded(name, fn, { notifyFailure = true } = {}) {
    const id = crypto.randomUUID(); const start = Date.now(); const db = getDb();
    db.prepare(`INSERT INTO system_job_runs(id,job_name,status) VALUES(?,?,'RUNNING')`).run(id, name);
    try {
      const detail = await fn();
      db.prepare(`UPDATE system_job_runs SET status='COMPLETED',detail=?,finished_at=datetime('now'),duration_ms=? WHERE id=?`).run(JSON.stringify(detail ?? {}), Date.now() - start, id);
      Logger.info('system', name, detail);
      return detail;
    } catch (error) {
      const safe = redactSecrets(error.message || error);
      db.prepare(`UPDATE system_job_runs SET status='FAILED',detail=?,finished_at=datetime('now'),duration_ms=? WHERE id=?`).run(safe.slice(0, 4000), Date.now() - start, id);
      Logger.error('system', `${name}_failed`, safe, { errorCode: 'SYSTEM_JOB' });
      if (notifyFailure && this.ownerUserId) await NotificationManager.systemFailure(this.ownerUserId, `System Job 실패: ${name}`, safe);
      throw error;
    }
  }

  async runDue() {
    if (this.due('daily_core_backup')) await this.runRecorded('daily_core_backup', () => BackupManager.createCoreBackup({ reason: 'daily-system-job' }));
    if (this.due('cleanup_30d')) await this.runRecorded('cleanup_30d', () => this.cleanup30d());
  }

  cleanupLogDirectory() {
    const logDir = path.join(process.env.DATA_DIR || '/data', 'logs');
    if (!fs.existsSync(logDir)) return 0;
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    let deleted = 0;
    for (const entry of fs.readdirSync(logDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(logDir, entry.name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) { fs.rmSync(file, { force: true }); deleted++; }
      } catch {}
    }
    return deleted;
  }

  async cleanup30d() {
    const db = getDb();
    const sessions = db.prepare(`SELECT id FROM sessions WHERE status='DELETED' AND deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')`).all();
    const ids = sessions.map((s) => s.id);
    let removedFiles = 0;
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const attachments = db.prepare(`SELECT local_path FROM attachments WHERE session_id IN (${placeholders})`).all(...ids);
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM attachments WHERE session_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM jobs WHERE session_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM messages WHERE session_id IN (${placeholders})`).run(...ids);
        db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids);
      });
      tx();
      for (const row of attachments) { try { if (row.local_path && fs.existsSync(row.local_path)) { fs.rmSync(row.local_path, { force: true }); removedFiles++; } } catch {} }
    }
    const oldLogs = db.prepare(`DELETE FROM structured_logs WHERE timestamp < datetime('now','-30 days')`).run().changes;
    const oldRuns = db.prepare(`DELETE FROM system_job_runs WHERE finished_at IS NOT NULL AND finished_at < datetime('now','-30 days')`).run().changes;
    const oldLogFiles = this.cleanupLogDirectory();
    return { deletedSessions: ids.length, deletedUploadFiles: removedFiles, deletedStructuredLogs: oldLogs, deletedSystemJobRuns: oldRuns, deletedLogFiles: oldLogFiles };
  }
}

export const SystemJobs = new SystemJobsImpl();
