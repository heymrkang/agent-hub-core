import 'dotenv/config';
import { initDatabase } from './database/index.js';
import { initTelegramBot } from './telegram.js';

console.log('==========================================');
console.log('       Agent Hub Core V1 (Phase 1)');
console.log('==========================================');

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

try {
  // 1. SQLite 데이터베이스 초기화 및 마이그레이션 실행
  initDatabase();

  // 2. Telegram Bot 초기화 및 Polling 시작
  initTelegramBot();
} catch (error) {
  console.error('[Fatal Init Error]', error.message);
  process.exit(1);
}
