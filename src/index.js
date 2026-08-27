import 'dotenv/config';
import { initDatabase } from './database/index.js';
import { JobRuntime } from './jobs/job-runtime.js';
import { initTelegramBot } from './telegram.js';
import { schedulerEngine } from './scheduler/engine.js';
import { SshManager } from './ssh/ssh-manager.js';
import { GitManager } from './git/git-manager.js';
import { DockerClient } from './docker/docker-client.js';

console.log('==========================================');
console.log('            Agent Hub Core V1');
console.log('==========================================');

process.on('uncaughtException', (err) => console.error('[FATAL] Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason));

try {
  initDatabase();
  JobRuntime.recoverInterruptedJobs();

  const sshSummary = SshManager.init();
  console.log(`[SSH] persistent config 준비 완료: ${sshSummary.enabled}/${sshSummary.total} enabled`);

  GitManager.init().catch((error) => console.warn(`[Git] 초기화 경고: ${error.message}`));
  DockerClient.getSummary().then((summary) => {
    if (summary.available) console.log(`[Docker] daemon 연결 완료: ${summary.serverVersion || 'unknown'} / running=${summary.running ?? 'unknown'}`);
    else console.warn(`[Docker] daemon 사용 불가 (Core는 계속 실행): ${summary.error || 'socket/daemon unavailable'}`);
  }).catch((error) => console.warn(`[Docker] 상태 확인 실패 (Core는 계속 실행): ${error.message}`));

  const bot = initTelegramBot();
  schedulerEngine.start(bot);
} catch (error) {
  console.error('[Fatal Init Error]', error.message);
  process.exit(1);
}
