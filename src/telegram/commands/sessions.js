import { SessionManager } from '../../sessions/session-manager.js';
import { formatKST } from '../../utils/date.js';

/**
 * /sessions 명령어 처리: 세션 목록 및 관리 UI 제공
 */
export async function handleSessionsCommand(bot, msg, status = 'ACTIVE') {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id;
  const userId = msg.from.id;

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const sessions = SessionManager.listSessions(userId, status);

    let messageText = `📁 **세션 목록 (${status})**\n\n`;
    messageText += `⭐ **현재 활성 세션**: **${activeSession.title}** (${activeSession.active_provider})\n\n`;

    if (sessions.length === 0) {
      messageText += `_${status} 상태의 세션이 없습니다._`;
    }

    const inlineKeyboard = [];

    // 세션별 버튼 행 생성 (최대 10개)
    for (const session of sessions.slice(0, 10)) {
      const isCurrent = session.id === activeSession.id && status === 'ACTIVE';
      const icon = isCurrent ? '🟢' : status === 'ARCHIVED' ? '📦' : status === 'DELETED' ? '🗑️' : '⚪';
      const lockIcon = session.title_locked ? ' 🔒' : '';
      const buttonLabel = `${icon} ${session.title}${lockIcon}`;

      const row = [
        {
          text: buttonLabel,
          callback_data: `session_info:${session.id}`
        }
      ];

      // 활성 탭일 때 전환 버튼
      if (status === 'ACTIVE' && !isCurrent) {
        row.push({
          text: '👉 전환',
          callback_data: `session_switch:${session.id}`
        });
      }

      // 복구 버튼 (ARCHIVED 또는 DELETED 탭)
      if (status !== 'ACTIVE') {
        row.push({
          text: '♻️ 복구',
          callback_data: `session_restore:${session.id}`
        });
      }

      inlineKeyboard.push(row);
    }

    // 하단 탭 메뉴
    const tabRow = [
      { text: status === 'ACTIVE' ? '✅ 활성' : '활성', callback_data: 'session_tab:ACTIVE' },
      { text: status === 'ARCHIVED' ? '✅ 보관함' : '보관함', callback_data: 'session_tab:ARCHIVED' },
      { text: status === 'DELETED' ? '✅ 휴지통' : '휴지통', callback_data: 'session_tab:DELETED' }
    ];
    inlineKeyboard.push(tabRow);

    // 신규 생성 버튼
    inlineKeyboard.push([
      { text: '➕ 새 세션 만들기 (/new)', callback_data: 'session_create_new' }
    ]);

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    };

    if (msg.message_id && !msg.chat) {
      // Callback Query에서 호출된 경우 메시지 편집
      await bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: msg.message.message_id,
        ...options
      });
    } else {
      await bot.sendMessage(chatId, messageText, options);
    }
  } catch (error) {
    console.error(`[Command /sessions Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 세션 목록 조회 실패: ${error.message}`);
  }
}

/**
 * 세션 상세 정보 및 개별 관리 액션 팝업
 */
async function showSessionDetail(bot, callbackQuery, sessionId) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;

  const session = SessionManager.getSession(sessionId);
  if (!session) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션을 찾을 수 없습니다.' });
    return;
  }

  const activeSession = SessionManager.getActiveSession(userId);
  const isCurrent = session.id === activeSession.id;

  let text = `📄 **세션 정보**\n\n`;
  text += `📌 **제목**: ${session.title} ${session.title_locked ? '🔒' : ''}\n`;
  text += `🤖 **Provider**: ${session.active_provider}\n`;
  text += `⚙️ **Profile**: ${session.execution_profile}\n`;
  text += `📊 **상태**: ${session.status}\n`;
  text += `🕒 **생성일**: ${formatKST(session.created_at)}\n`;
  text += `🔄 **최근활동**: ${formatKST(session.updated_at)}\n`;

  const buttons = [];

  if (session.status === 'ACTIVE') {
    if (!isCurrent) {
      buttons.push([{ text: '👉 이 세션으로 전환', callback_data: `session_switch:${session.id}` }]);
    }
    buttons.push([
      { text: '📦 보관 (Archive)', callback_data: `session_archive:${session.id}` },
      { text: '🗑️ 삭제 (Soft Delete)', callback_data: `session_delete:${session.id}` }
    ]);
  } else {
    buttons.push([
      { text: '♻️ 활성 세션으로 복구 (Restore)', callback_data: `session_restore:${session.id}` }
    ]);
  }

  buttons.push([{ text: '🔙 목록으로 돌아가기', callback_data: `session_tab:${session.status}` }]);

  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
  await bot.answerCallbackQuery(callbackQuery.id);
}

/**
 * Sessions 관련 Callback Query 라우터
 */
export async function handleSessionsCallback(bot, callbackQuery) {
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;

  if (data.startsWith('session_tab:')) {
    const tab = data.replace('session_tab:', '');
    await handleSessionsCommand(bot, callbackQuery, tab);
    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  if (data.startsWith('session_info:')) {
    const sessionId = data.replace('session_info:', '');
    await showSessionDetail(bot, callbackQuery, sessionId);
    return;
  }

  if (data.startsWith('session_switch:')) {
    const sessionId = data.replace('session_switch:', '');
    SessionManager.setActiveSession(userId, sessionId);
    const session = SessionManager.getSession(sessionId);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `[${session?.title || '세션'}] (으)로 전환되었습니다.`
    });
    await handleSessionsCommand(bot, callbackQuery, 'ACTIVE');
    return;
  }

  if (data.startsWith('session_archive:')) {
    const sessionId = data.replace('session_archive:', '');
    SessionManager.archiveSession(sessionId);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션이 보관되었습니다.' });
    await handleSessionsCommand(bot, callbackQuery, 'ACTIVE');
    return;
  }

  if (data.startsWith('session_delete:')) {
    const sessionId = data.replace('session_delete:', '');
    SessionManager.softDeleteSession(sessionId);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션이 삭제되었습니다 (30일 보존).' });
    await handleSessionsCommand(bot, callbackQuery, 'ACTIVE');
    return;
  }

  if (data.startsWith('session_restore:')) {
    const sessionId = data.replace('session_restore:', '');
    SessionManager.restoreSession(sessionId);
    SessionManager.setActiveSession(userId, sessionId);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션이 복구되어 활성화되었습니다.' });
    await handleSessionsCommand(bot, callbackQuery, 'ACTIVE');
    return;
  }

  if (data === 'session_create_new') {
    const newSession = SessionManager.createSession(userId);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '새 세션이 생성되었습니다.' });
    await bot.sendMessage(
      chatId,
      `✨ **새 세션이 생성되었습니다.** (${newSession.title})`,
      { parse_mode: 'Markdown' }
    );
    await handleSessionsCommand(bot, callbackQuery, 'ACTIVE');
  }
}
