import TelegramBot from 'node-telegram-bot-api';
import { executeCodex } from './codex.js';

const TELEGRAM_MAX_LENGTH = 4000;

/**
 * 텍스트가 텔레그램 메시지 길이 제한을 초과할 경우 분할
 */
function splitMessage(text, maxLength = TELEGRAM_MAX_LENGTH) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex <= 0) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

export function initTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
  }

  const rawAllowedIds = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
  const allowedUserIds = new Set(
    rawAllowedIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );

  console.log(`[Telegram] 허용된 사용자 ID: [${Array.from(allowedUserIds).join(', ')}]`);

  const bot = new TelegramBot(token, { polling: true });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id || '');
    const text = msg.text?.trim();

    if (!text) return;

    // 허용된 유저 검증
    if (allowedUserIds.size > 0 && !allowedUserIds.has(userId)) {
      console.warn(`[Telegram] 비인가 사용자 차단: ID=${userId}, Username=${msg.from?.username}`);
      await bot.sendMessage(chatId, `⛔ 인가되지 않은 사용자입니다. (User ID: ${userId})`);
      return;
    }

    console.log(`[Telegram] 메시지 수신 [${userId}]: ${text}`);

    if (text === '/start') {
      await bot.sendMessage(
        chatId,
        '🤖 Docker Agent Telegram 준비 완료.\n\n메시지를 입력하면 Codex CLI를 통해 응답을 생성합니다.'
      );
      return;
    }

    // typing 액션 유지
    const sendTypingInterval = setInterval(() => {
      bot.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    try {
      const response = await executeCodex(text);

      clearInterval(sendTypingInterval);

      const chunks = splitMessage(response);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } catch (err) {
      clearInterval(sendTypingInterval);
      console.error(`[Codex Error] ${err.message}`);
      await bot.sendMessage(chatId, `❌ 에러 발생:\n${err.message}`);
    }
  });

  bot.on('polling_error', (error) => {
    console.error(`[Telegram Polling Error] ${error.code}: ${error.message}`);
  });

  console.log('[Telegram] Bot Polling 시작.');
  return bot;
}
