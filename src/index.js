import 'dotenv/config';
import { initDatabase } from './database/index.js';
import { JobRuntime } from './jobs/job-runtime.js';
import { initTelegramBot } from './telegram.js';
import { schedulerEngine } from './scheduler/engine.js';
import { SshManager } from './ssh/ssh-manager.js';
import { GitManager } from './git/git-manager.js';
import { DockerClient } from './docker/docker-client.js';
import { initSettingsManager } from './settings/settings-manager.js';
import { startHealthServer } from './health/health-server.js';
import { NotificationManager } from './notifications/notification-manager.js';
import { SystemJobs } from './system/system-jobs.js';
import { Logger } from './logging/logger.js';

console.log('==========================================');
console.log('            Agent Hub Core V1');
console.log('==========================================');

process.on('uncaughtException', (err) => { console.error('[FATAL] Uncaught Exception:', err); try { Logger.error('error', 'uncaught_exception', err?.message || String(err)); } catch {} });
process.on('unhandledRejection', (reason, promise) => { console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason); try { Logger.error('error', 'unhandled_rejection', reason?.message || String(reason)); } catch {} });

try {
  const db = initDatabase();
  initSettingsManager(db);
  console.log('[Settings] persistent settings 준비 완료.');
  JobRuntime.recoverInterruptedJobs();

  const sshSummary = SshManager.init();
  console.log(`[SSH] persistent config 준비 완료: ${sshSummary.enabled}/${sshSummary.total} enabled`);

  GitManager.init().catch((error) => console.warn(`[Git] 초기화 경고: ${error.message}`));
  DockerClient.getSummary().then((summary) => {
    if (summary.available) console.log(`[Docker] daemon 연결 완료: ${summary.serverVersion || 'unknown'} / running=${summary.running ?? 'unknown'}`);
    else console.warn(`[Docker] daemon 사용 불가 (Core는 계속 실행): ${summary.error || 'socket/daemon unavailable'}`);
  }).catch((error) => console.warn(`[Docker] 상태 확인 실패 (Core는 계속 실행): ${error.message}`));

  const bot = initTelegramBot();
  NotificationManager.init(bot);
  schedulerEngine.start(bot);
  startHealthServer();
  const ownerId = String(process.env.TELEGRAM_ADMIN_USER_ID || process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map((v) => v.trim()).find(Boolean) || null;
  SystemJobs.start(ownerId);
  Logger.info('app', 'startup_complete', { schema: db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v || 0 });
} catch (error) {
  console.error('[Fatal Init Error]', error.message);
  process.exit(1);
}
