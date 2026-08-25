import { SessionManager } from '../../sessions/session-manager.js';

/**
 * /new 명령어 처리: 새 세션 생성 및 즉시 활성화
 */
export async function handleNewCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    const newSession = SessionManager.createSession(userId, {
      title: '새 채팅',
      provider: 'codex',
      profile: 'WORKSPACE'
    });

    await bot.sendMessage(
      chatId,
      `✨ **새 세션이 생성되었습니다.**\n\n📌 **제목**: ${newSession.title}\n🤖 **Provider**: ${newSession.active_provider}\n⚙️ **Profile**: ${newSession.execution_profile}\n\n이제 메시지를 입력하시면 이 세션에 기록됩니다.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error(`[Command /new Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 새 세션 생성 실패: ${error.message}`);
  }
}
