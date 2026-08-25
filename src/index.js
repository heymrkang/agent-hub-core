import 'dotenv/config';
import { initTelegramBot } from './telegram.js';

console.log('==========================================');
console.log('   Docker Agent Telegram (Phase 1)');
console.log('==========================================');

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

try {
  initTelegramBot();
} catch (error) {
  console.error('[Init Error]', error.message);
  process.exit(1);
}
