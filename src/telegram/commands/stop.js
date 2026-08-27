import { queueManager } from '../../jobs/queue-manager.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { isStealthMode, uiStatusIcon } from '../renderer/ui-theme.js';

export async function handleStopCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const cancelled = queueManager.cancelActiveJobForSession(activeSession.id);
    if (cancelled) {
      await bot.sendMessage(chatId, `${isStealthMode() ? '[STOP]' : '🛑'} **[${activeSession.title}]** 세션의 작업이 즉시 중단되었습니다.`, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `${isStealthMode() ? '[i]' : 'ℹ️'} 현재 **[${activeSession.title}]** 세션에서 실행 중이거나 대기 중인 작업이 없습니다.`, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error(`[Command /stop Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 작업 중단 실패: ${error.message}`);
  }
}

export async function handleJobCancelCallback(bot, callbackQuery) {
  const data = callbackQuery.data;
  let cancelled = false;
  if (data.startsWith('job_cancel_session:')) cancelled = queueManager.cancelActiveJobForSession(data.replace('job_cancel_session:', ''));
  else if (data.startsWith('job_cancel:')) cancelled = queueManager.cancelJob(data.replace('job_cancel:', ''));
  await bot.answerCallbackQuery(callbackQuery.id, { text: cancelled ? '작업이 즉시 중단되었습니다.' : '이미 완료되었거나 실행 중이지 않은 작업입니다.' });
}
