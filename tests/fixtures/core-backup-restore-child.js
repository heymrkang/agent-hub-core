import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initDatabase, getDb } from '../../src/database/index.js';
import { BackupManager } from '../../src/backup/backup-manager.js';

initDatabase();
const db = getDb();

db.prepare('INSERT INTO users (id, role) VALUES (?, ?)').run(1, 'OWNER');
db.prepare(`INSERT INTO sessions (id,user_id,title,active_provider,execution_profile,status) VALUES(?,?,?,?,?,?)`)
  .run('session-backup', 1, 'Backup Session', 'codex', 'WORKSPACE', 'ACTIVE');
db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
  .run('phase11_probe', 'settings-ok');
db.prepare(`INSERT INTO memory_logs (id,action,source,new_content) VALUES (?,?,?,?)`)
  .run('memory-backup', 'UPDATE', 'USER', 'memory-ok');
db.prepare(`
  INSERT INTO schedules (id,user_id,name,schedule_type,schedule_value,timezone,provider,execution_profile,prompt,enabled)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`).run('schedule-backup', 1, 'Backup Schedule', 'DAILY', '09:00', 'Asia/Seoul', 'codex', 'WORKSPACE', 'schedule-ok', 1);

const backup = await BackupManager.createCoreBackup({ reason: 'phase11-restore-test' });
const restoreDir = path.join(process.env.DATA_DIR, 'restore-target');
fs.mkdirSync(restoreDir, { recursive: true });
const restoredPath = path.join(restoreDir, 'agent-hub.db');
fs.copyFileSync(backup.path, restoredPath);

const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
try {
  const quick = restored.pragma('quick_check', { simple: true });
  const result = {
    quick,
    session: restored.prepare('SELECT title FROM sessions WHERE id=?').get('session-backup')?.title,
    setting: restored.prepare('SELECT value FROM settings WHERE key=?').get('phase11_probe')?.value,
    memory: restored.prepare('SELECT new_content FROM memory_logs WHERE id=?').get('memory-backup')?.new_content,
    schedule: restored.prepare('SELECT prompt FROM schedules WHERE id=?').get('schedule-backup')?.prompt,
    backupExists: fs.existsSync(backup.path)
  };
  process.stdout.write(JSON.stringify(result));
} finally {
  restored.close();
}
