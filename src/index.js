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
import { startPreviewRouteServer } from './preview/preview-route-server.js';
import { getPreviewService } from './preview/preview-service.js';
import { safeErrorMessage } from './telegram/transport.js';
import { MemoryManager } from './memory/memory-manager.js';
import { mcpSyncService } from './extensions/mcp-sync-service.js';

console.log('==========================================');
console.log('          Agent Hub Core V2 · 2.0.0');
console.log('==========================================');

process.on('uncaughtException', (err) => {
  const message = safeErrorMessage(err);
  console.error(`[FATAL] Uncaught Exception: ${message}`);
  try { Logger.error('error', 'uncaught_exception', message); } catch {}
});
process.on('unhandledRejection', (reason) => {
  const message = safeErrorMessage(reason);
  console.error(`[FATAL] Unhandled Rejection: ${message}`);
  try { Logger.error('error', 'unhandled_rejection', message); } catch {}
});

try {
  const db = initDatabase();
  initSettingsManager(db);
  console.log('[Settings] persistent settings 준비 완료.');
  try {
    MemoryManager.syncProviderRules();
  } catch (error) {
    console.warn(`[MemorySync] 시작 시 Provider Rules 동기화 실패: ${safeErrorMessage(error)}`);
  }
  try {
    mcpSyncService.syncAll();
  } catch (error) {
    console.warn(`[McpSync] 시작 시 MCP 동기화 실패: ${safeErrorMessage(error)}`);
  }
  JobRuntime.recoverInterruptedJobs();

  const sshSummary = SshManager.init();
  console.log(`[SSH] persistent config 준비 완료: ${sshSummary.enabled}/${sshSummary.total} enabled`);

  GitManager.init().catch((error) => console.warn(`[Git] 초기화 경고: ${safeErrorMessage(error)}`));
  DockerClient.getSummary().then((summary) => {
    if (summary.available) console.log(`[Docker] daemon 연결 완료: ${summary.serverVersion || 'unknown'} / running=${summary.running ?? 'unknown'}`);
    else console.warn(`[Docker] daemon 사용 불가 (Core는 계속 실행): ${summary.error || 'socket/daemon unavailable'}`);
  }).catch((error) => console.warn(`[Docker] 상태 확인 실패 (Core는 계속 실행): ${safeErrorMessage(error)}`));

  const bot = initTelegramBot();
  NotificationManager.init(bot);
  schedulerEngine.start(bot);
  startHealthServer();
  startPreviewRouteServer();
  try {
    const previewSummary = await getPreviewService().cleanup.startupReconcile();
    Logger.info('system', 'preview_startup_reconcile', previewSummary);
  } catch (error) {
    const message = safeErrorMessage(error);
    console.error(`[Preview] 시작 시 복구 실패: ${message}`);
    Logger.error('system', 'preview_startup_reconcile_failed', message, { errorCode: 'PREVIEW_CLEANUP' });
  }
  const ownerId = String(process.env.TELEGRAM_ADMIN_USER_ID || process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map((v) => v.trim()).find(Boolean) || null;
  SystemJobs.start(ownerId);
  Logger.info('app', 'startup_complete', { schema: db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v || 0, version: '2.0.0' });
} catch (error) {
  console.error(`[Fatal Init Error] ${safeErrorMessage(error)}`);
  process.exit(1);
}
