import { SessionManager } from '../../sessions/session-manager.js';

const LABELS = {
  READ_ONLY: 'READ_ONLY · 읽기 전용',
  WORKSPACE: 'WORKSPACE · 작업공간',
  FULL_ACCESS: 'FULL_ACCESS · 인프라 전체 접근'
};

async function render(bot, source) {
  const chatId = source.chat ? source.chat.id : source.message.chat.id;
  const session = SessionManager.getActiveSession(source.from.id);
  const text = `⚙️ **Execution Profile**\n\n현재 세션: **${session.title}**\n현재 Profile: \`${session.execution_profile}\`\n\nREAD_ONLY: 코드/상태 확인 위주\nWORKSPACE: /workspace 내 개발 작업 기본\nFULL_ACCESS: SSH/Docker/Git 등 인프라 작업용\n\n_FULL_ACCESS는 Docker socket/SSH를 사용할 수 있는 강력한 권한입니다._`;
  const keyboard = Object.keys(LABELS).map((profile) => ([{
    text: `${session.execution_profile === profile ? '✓ ' : ''}${LABELS[profile]}`,
    callback_data: `profile_set:${profile}`
  }]));
  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  if (!source.chat && source.message?.message_id) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: source.message.message_id, ...options }).catch((e) => {
      if (!/message is not modified/i.test(e.message)) throw e;
    });
  } else {
    await bot.sendMessage(chatId, text, options);
  }
}

export async function handleProfileCommand(bot, msg) {
  try { await render(bot, msg); }
  catch (error) { await bot.sendMessage(msg.chat.id, `❌ Profile 조회 실패: ${error.message}`); }
}

export async function handleProfileCallback(bot, q) {
  const data = q.data || '';
  if (!data.startsWith('profile_set:')) return;
  try {
    const profile = data.slice('profile_set:'.length);
    const session = SessionManager.getActiveSession(q.from.id);
    SessionManager.setExecutionProfile(session.id, profile);
    await bot.answerCallbackQuery(q.id, { text: `Execution Profile: ${profile}` });
    await render(bot, q);
  } catch (error) {
    try { await bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`, show_alert: true }); } catch {}
  }
}
