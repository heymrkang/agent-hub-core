import { initDatabase, getDb } from '../../src/database/index.js';
import { JobRuntime } from '../../src/jobs/job-runtime.js';

initDatabase();
const db = getDb();

db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(1, 'OWNER');
db.prepare(`
  INSERT INTO sessions (id, user_id, title, active_provider, execution_profile, status)
  VALUES (?, ?, ?, ?, ?, ?)
`).run('session-1', 1, 'Restart Test', 'codex', 'WORKSPACE', 'ACTIVE');

db.prepare(`
  INSERT INTO jobs (id, session_id, type, provider, model, status, queued_at, started_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`).run('job-running', 'session-1', 'CHAT', 'codex', null, 'RUNNING');

db.prepare(`
  INSERT INTO jobs (id, session_id, type, provider, model, status, queued_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
`).run('job-queued', 'session-1', 'CHAT', 'codex', null, 'QUEUED');

JobRuntime.recoverInterruptedJobs();

const running = db.prepare('SELECT status, error_category, error_message, ended_at FROM jobs WHERE id = ?').get('job-running');
const queued = db.prepare('SELECT status FROM jobs WHERE id = ?').get('job-queued');

process.stdout.write(JSON.stringify({ running, queued }));
