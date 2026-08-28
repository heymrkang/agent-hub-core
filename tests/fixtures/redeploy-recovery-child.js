import { initDatabase, getDb } from '../../src/database/index.js';
import { JobRuntime } from '../../src/jobs/job-runtime.js';

const mode = process.argv[2];
initDatabase();
const db = getDb();

if (mode === 'seed') {
  db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(1, 'OWNER');
  db.prepare(`INSERT INTO sessions (id,user_id,title,active_provider,execution_profile,status) VALUES(?,?,?,?,?,?)`)
    .run('session-persist', 1, 'Persistent Session', 'codex', 'WORKSPACE', 'ACTIVE');
  db.prepare(`INSERT INTO messages (id,session_id,role,text,provider) VALUES(?,?,?,?,?)`)
    .run('message-persist', 'session-persist', 'user', 'persist-me', 'codex');
  db.prepare(`INSERT INTO memory_logs (id,action,source,new_content) VALUES(?,?,?,?)`)
    .run('memory-persist', 'UPDATE', 'USER', 'persistent-memory');
  db.prepare(`INSERT INTO schedules (id,user_id,name,schedule_type,schedule_value,provider,execution_profile,prompt,enabled) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run('schedule-persist', 1, 'Persistent Schedule', 'DAILY', '10:00', 'codex', 'WORKSPACE', 'persistent-schedule', 1);
  db.prepare(`INSERT INTO ssh_hosts (id,user_id,alias,host,port,username,identity_file,enabled) VALUES(?,?,?,?,?,?,?,?)`)
    .run('ssh-persist', 1, 'dev', '192.0.2.10', 22, 'root', '/data/ssh/keys/dev.key', 1);
  db.prepare(`INSERT INTO jobs (id,session_id,type,provider,status,queued_at,started_at) VALUES(?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run('job-persist', 'session-persist', 'CHAT', 'codex', 'RUNNING');
  process.stdout.write('SEEDED');
} else if (mode === 'verify') {
  JobRuntime.recoverInterruptedJobs();
  const result = {
    session: db.prepare('SELECT title FROM sessions WHERE id=?').get('session-persist')?.title,
    message: db.prepare('SELECT text FROM messages WHERE id=?').get('message-persist')?.text,
    memory: db.prepare('SELECT new_content FROM memory_logs WHERE id=?').get('memory-persist')?.new_content,
    schedule: db.prepare('SELECT prompt FROM schedules WHERE id=?').get('schedule-persist')?.prompt,
    ssh: db.prepare('SELECT alias FROM ssh_hosts WHERE id=?').get('ssh-persist')?.alias,
    job: db.prepare('SELECT status,error_category FROM jobs WHERE id=?').get('job-persist')
  };
  process.stdout.write(JSON.stringify(result));
} else {
  throw new Error(`unknown mode: ${mode}`);
}
