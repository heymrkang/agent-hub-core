import 'dotenv/config';
import { initDatabase } from './database/index.js';
import { JobRuntime } from './jobs/job-runtime.js';
import { initTelegramBot } from './telegram.js';

console.log('==========================================');
console.log('            Agent Hub Core V1');
console.log('==========================================');

process.on('uncaughtException', (err) => console.error('[FATAL] Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason));

try {
  initDatabase();
  JobRuntime.recoverInterruptedJobs();
  initTelegramBot();
} catch (error) {
  console.error('[Fatal Init Error]', error.message);
  process.exit(1);
}
