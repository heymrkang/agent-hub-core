import { queueManager } from '../../jobs/queue-manager.js';
import { SessionManager } from '../../sessions/session-manager.js';

/**
 * /stop 명령어 처리: 현재 활성 세션의 실행 중인 작업 취소
 */
export async function handleStopCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    const cancelled = queueManager.cancelActiveJobForSession(activeSession.id);

    if (cancelled) {
      await bot.sendMessage(
        chatId,
        `🛑 **[${activeSession.title}]** 세션의 작업이 즉시 중단되었습니다.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await bot.sendMessage(
        chatId,
        `ℹ️ 현재 **[${activeSession.title}]** 세션에서 실행 중이거나 대기 중인 작업이 없습니다.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error(`[Command /stop Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 작업 중단 실패: ${error.message}`);
  }
}

/**
 * 인라인 버튼 작업 취소 콜백 처리
 */
export async function handleJobCancelCallback(bot, callbackQuery) {
  const data = callbackQuery.data;
  const jobId = data.replace('job_cancel:', '');

  const cancelled = queueManager.cancelJob(jobId);
  if (cancelled) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '작업이 중단되었습니다.' });
  } else {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '이미 완료되었거나 실행 중이지 않은 작업입니다.' });
  }
}
