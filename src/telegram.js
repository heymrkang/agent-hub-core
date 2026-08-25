import TelegramBot from 'node-telegram-bot-api';
import { executeCodex } from './codex.js';
import { isAuthorizedUser } from './telegram/auth.js';
import { SessionManager } from './sessions/session-manager.js';
import { handleNewCommand } from './telegram/commands/new.js';
import { handleRenameCommand } from './telegram/commands/rename.js';
import { handleSessionsCommand, handleSessionsCallback } from './telegram/commands/sessions.js';

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

  const bot = new TelegramBot(token, { polling: true });

  // 1. 일반 메시지 및 커맨드 핸들러
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const from = msg.from;
    const text = msg.text?.trim();

    if (!text) return;

    // 단일 소유자 인증 검증
    if (!isAuthorizedUser(from)) {
      return;
    }

    const userId = from.id;

    // 명령어 라우팅
    if (text === '/start' || text === '/help') {
      const activeSession = SessionManager.getActiveSession(userId);
      const helpText =
        `🤖 **Agent Hub Core V1**\n\n` +
        `⭐ **현재 활성 세션**: **${activeSession.title}** (${activeSession.active_provider})\n\n` +
        `📌 **사용 가능한 명령어**:\n` +
        `• \`/new\` : 새 세션 생성 및 즉시 활성화\n` +
        `• \`/sessions\` : 세션 목록, 전환, 보관, 복구\n` +
        `• \`/rename <새 제목>\` : 활성 세션 이름 변경\n` +
        `• \`/help\` : 도움말 보기\n\n` +
        `메시지를 입력하면 현재 활성 세션에서 Codex CLI를 통해 작업이 진행됩니다.`;

      await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
      return;
    }

    if (text === '/new') {
      await handleNewCommand(bot, msg);
      return;
    }

    if (text === '/sessions') {
      await handleSessionsCommand(bot, msg);
      return;
    }

    if (text.startsWith('/rename')) {
      const args = text.replace(/^\/rename\s*/, '');
      await handleRenameCommand(bot, msg, args);
      return;
    }

    // 일반 프롬프트 실행
    const activeSession = SessionManager.getActiveSession(userId);
    console.log(`[Telegram] 메시지 수신 [Session: ${activeSession.id} / ${activeSession.title}]: ${text}`);

    // 사용자 질문을 Canonical DB에 영속화
    SessionManager.saveMessage({
      sessionId: activeSession.id,
      role: 'user',
      text
    });

    // typing 액션 유지
    const sendTypingInterval = setInterval(() => {
      bot.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    try {
      // Codex 비대화형 실행
      const response = await executeCodex(text);

      clearInterval(sendTypingInterval);

      // AI 답변을 Canonical DB에 원문 통째로 1건 저장
      SessionManager.saveMessage({
        sessionId: activeSession.id,
        role: 'assistant',
        text: response,
        provider: activeSession.active_provider,
        model: activeSession.active_model
      });

      // 텔레그램에는 길이 제한에 맞게 안전 분할하여 전송
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

  // 2. 인라인 키보드 Callback Query 핸들러
  bot.on('callback_query', async (callbackQuery) => {
    if (!isAuthorizedUser(callbackQuery.from)) {
      return;
    }

    const data = callbackQuery.data;
    if (data.startsWith('session_')) {
      await handleSessionsCallback(bot, callbackQuery);
    }
  });

  bot.on('polling_error', (error) => {
    console.error(`[Telegram Polling Error] ${error.code}: ${error.message}`);
  });

  console.log('[Telegram] Bot Polling 시작 완료.');
  return bot;
}
