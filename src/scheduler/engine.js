import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { SessionManager } from '../sessions/session-manager.js';
import { queueManager } from '../jobs/queue-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { modelCatalog } from '../providers/model-catalog.js';
import { computeNextRun, ScheduleRunStatus } from './types.js';

class SchedulerEngine {
  constructor() { this.timer = null; this.runningSchedules = new Set(); this.bot = null; }

  start(bot = null) {
    if (this.timer) return;
    this.bot = bot;
    this.ensureSystemSchedules();
    this.reconcileMissedRuns();
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[Scheduler] tick 실패:', e.message)), 15000);
    setTimeout(() => this.tick().catch(() => {}), 1000);
    console.log('[Scheduler] Internal Scheduler 시작 완료.');
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  ensureSystemSchedules() {
    const db = getDb();
    const interval = String(Math.max(3600, Number(process.env.MODEL_REFRESH_INTERVAL_SECONDS || 21600)));
    for (const provider of ['codex','antigravity']) {
      const id = `system:model-refresh:${provider}`;
      const existing = db.prepare('SELECT id FROM schedules WHERE id=?').get(id);
      if (!existing) {
        const next = new Date(Date.now() + 3000).toISOString();
        db.prepare(`INSERT INTO schedules(id,name,kind,schedule_type,schedule_value,timezone,provider,prompt,timeout_seconds,enabled,next_run_at) VALUES(?,?, 'SYSTEM','INTERVAL',?,'UTC',?,'MODEL_CATALOG_REFRESH',120,1,?)`)
          .run(id, `Model Catalog Refresh: ${provider}`, interval, provider, next);
      }
    }
  }

  reconcileMissedRuns() {
    const db = getDb(); const now = Date.now();
    const overdue = db.prepare(`SELECT * FROM schedules WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at < ?`).all(new Date(now - 120000).toISOString());
    for (const s of overdue) {
      this.recordRun(s.id, ScheduleRunStatus.MISSED, { errorMessage:'Agent Hub downtime 중 실행 시각 경과 — 자동 replay 안 함' });
      this.advanceSchedule(s, new Date());
    }
  }

  async tick() {
    const db = getDb();
    const due = db.prepare(`SELECT * FROM schedules WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT 20`).all(new Date().toISOString());
    for (const schedule of due) {
      if (this.runningSchedules.has(schedule.id)) {
        this.recordRun(schedule.id, ScheduleRunStatus.SKIPPED, { errorMessage:'Overlap policy SKIP' });
        this.advanceSchedule(schedule, new Date());
        continue;
      }
      this.runningSchedules.add(schedule.id);
      this.execute(schedule).finally(() => this.runningSchedules.delete(schedule.id));
      this.advanceSchedule(schedule, new Date());
    }
  }

  async execute(schedule) {
    const runId = crypto.randomUUID(); const db = getDb(); const started = Date.now();
    db.prepare(`INSERT INTO schedule_runs(id,schedule_id,status,started_at) VALUES(?,?,'RUNNING',datetime('now'))`).run(runId, schedule.id);
    try {
      let output;
      if (schedule.kind === 'SYSTEM') output = await this.executeSystem(schedule);
      else output = await this.executeUser(schedule);
      db.prepare(`UPDATE schedule_runs SET status='COMPLETED',finished_at=datetime('now'),output_text=?,output_summary=?,duration_ms=? WHERE id=?`)
        .run(String(output || ''), summarize(output), Date.now()-started, runId);
      if (schedule.kind === 'USER') await this.notify(schedule, `⏰ **예약 작업 완료**\n\n**${schedule.name}**\n\n${String(output || '').slice(0,3500)}`);
    } catch (error) {
      db.prepare(`UPDATE schedule_runs SET status='FAILED',finished_at=datetime('now'),error_message=?,duration_ms=? WHERE id=?`).run(String(error.message).slice(0,2000), Date.now()-started, runId);
      if (schedule.kind === 'USER') await this.notify(schedule, `❌ **예약 작업 실패**\n\n**${schedule.name}**\n${error.message}`);
    }
  }

  async executeSystem(schedule) {
    if (schedule.prompt === 'MODEL_CATALOG_REFRESH') {
      const result = await modelCatalog.refresh(schedule.provider, { force:true });
      return `${schedule.provider}: ${result.models.length}개 모델 갱신`;
    }
    throw new Error(`알 수 없는 SYSTEM schedule: ${schedule.prompt}`);
  }

  async executeUser(schedule) {
    const db = getDb();
    let executionSessionId = schedule.execution_session_id;
    let executionSession = executionSessionId ? SessionManager.getSession(executionSessionId) : null;
    if (!executionSession) {
      executionSession = SessionManager.createSession(schedule.user_id, { title:`__schedule__:${schedule.id}`, provider:schedule.provider, model:schedule.model, profile:schedule.execution_profile, isSystem:true, status:'ARCHIVED' });
      executionSessionId = executionSession.id;
      db.prepare('UPDATE schedules SET execution_session_id=?,updated_at=datetime(\'now\') WHERE id=?').run(executionSessionId, schedule.id);
    }
    const memory = MemoryManager.getMemoryForPrompt();
    const prompt = [memory, `[예약 작업 / 독립 실행]\n${schedule.prompt}`].filter(Boolean).join('\n\n');
    return queueManager.enqueueJob({ sessionId:executionSessionId, sessionTitle:schedule.name, provider:schedule.provider, model:schedule.model, prompt, profile:schedule.execution_profile, type:'SCHEDULER', timeoutMs:schedule.timeout_seconds*1000 });
  }

  advanceSchedule(schedule, from) {
    const db = getDb();
    if (schedule.schedule_type === 'ONCE') {
      db.prepare(`UPDATE schedules SET enabled=0,last_run_at=datetime('now'),next_run_at=NULL,updated_at=datetime('now') WHERE id=?`).run(schedule.id); return;
    }
    const next = computeNextRun(schedule.schedule_type, schedule.schedule_value, schedule.timezone, from);
    db.prepare(`UPDATE schedules SET last_run_at=datetime('now'),next_run_at=?,updated_at=datetime('now') WHERE id=?`).run(next?.toISOString() || null, schedule.id);
  }

  recordRun(scheduleId, status, { errorMessage = null } = {}) {
    getDb().prepare(`INSERT INTO schedule_runs(id,schedule_id,status,error_message,finished_at) VALUES(?,?,?,?,datetime('now'))`).run(crypto.randomUUID(), scheduleId, status, errorMessage);
  }

  async notify(schedule, text) {
    if (!this.bot || !schedule.user_id) return;
    try { await this.bot.sendMessage(schedule.user_id, text, { parse_mode:'Markdown' }); }
    catch { await this.bot.sendMessage(schedule.user_id, text.replace(/[*_`]/g,'' )).catch(()=>{}); }
  }
}
function summarize(value) { const s=String(value||'').replace(/\s+/g,' ').trim(); return s.slice(0,500); }
export const schedulerEngine = new SchedulerEngine();
