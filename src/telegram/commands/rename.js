import { SessionManager } from '../../sessions/session-manager.js';

/**
 * /rename <새 제목> 명령어 처리: 현재 활성 세션 이름 변경
 */
export async function handleRenameCommand(bot, msg, args) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const newTitle = args.trim();
  if (!newTitle) {
    await bot.sendMessage(
      chatId,
      'ℹ️ **사용법**: `/rename <새 세션 제목>`\n예시: `/rename 백엔드 리팩토링 작업`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    const activeSession = SessionManager.getActiveSession(userId);
    SessionManager.renameSession(activeSession.id, newTitle);

    await bot.sendMessage(
      chatId,
      `🏷️ **세션 제목이 변경되었습니다.**\n\n이전: ${activeSession.title}\n**변경됨**: **${newTitle}** 🔒(고정됨)`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error(`[Command /rename Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 세션 이름 변경 실패: ${error.message}`);
  }
}
