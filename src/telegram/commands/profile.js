import { SessionManager } from '../../sessions/session-manager.js';
import { isStealthMode } from '../renderer/ui-theme.js';

const LABELS = {
  READ_ONLY: 'READ_ONLY · 읽기 전용',
  WORKSPACE: 'WORKSPACE · 작업공간',
  FULL_ACCESS: 'FULL_ACCESS · 인프라 전체 접근'
};

function escapeMarkdown(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }

async function render(bot, source) {
  const chatId = source.chat ? source.chat.id : source.message.chat.id;
  const session = SessionManager.getActiveSession(source.from.id);
  const title = escapeMarkdown(session.title);
  const profile = escapeMarkdown(session.execution_profile);
  const stealth = isStealthMode();
  const text = `${stealth ? '■' : '⚙️'} **Execution Profile**\n\n현재 세션: **${title}**\n현재 Profile: \`${profile}\`\n\n\`READ_ONLY\`: /home/dev 읽기 전용 · 파일 생성/수정/Git 차단\n\`WORKSPACE\`: /home/dev 내 개발 및 Git 작업 허용 · 인프라 조작 차단\n\`FULL_ACCESS\`: SSH, Docker 소켓 및 시스템 전역 인프라 제어 전용\n\n*FULL_ACCESS는 Docker socket/SSH를 사용할 수 있는 강력한 권한입니다.*`;
  const keyboard = Object.keys(LABELS).map((profileName) => ([{
    text: `${session.execution_profile === profileName ? '✓ ' : ''}${LABELS[profileName]}`,
    callback_data: `profile_set:${profileName}`
  }]));
  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  if (!source.chat && source.message?.message_id) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: source.message.message_id, ...options }).catch((e) => { if (!/message is not modified/i.test(e.message)) throw e; });
  } else await bot.sendMessage(chatId, text, options);
}

export async function handleProfileCommand(bot, msg) {
  try { await render(bot, msg); }
  catch (error) { console.error(`[Command /profile Error] ${error.message}`); await bot.sendMessage(msg.chat.id, `${isStealthMode() ? '[ERR]' : '❌'} Profile 조회 실패: ${error.message}`); }
}

export async function handleProfileCallback(bot, q) {
  const data = q.data || ''; if (!data.startsWith('profile_set:')) return;
  try {
    const profile = data.slice('profile_set:'.length); const session = SessionManager.getActiveSession(q.from.id);
    SessionManager.setExecutionProfile(session.id, profile);
    await bot.answerCallbackQuery(q.id, { text: `Execution Profile: ${profile}` });
    await render(bot, q);
  } catch (error) {
    console.error(`[Profile Callback Error] ${error.message}`);
    try { await bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`, show_alert: true }); } catch {}
  }
}
