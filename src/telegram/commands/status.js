import { HealthService } from '../../health/health-service.js';
import { isStealthMode, uiTitle } from '../renderer/ui-theme.js';

const ICONS = { HEALTHY: '✅', DEGRADED: '⚠️', ERROR: '❌' };
const PLAIN = { HEALTHY: '[OK]', DEGRADED: '[WARN]', ERROR: '[ERR]' };

export async function handleStatusCommand(bot, msg) {
  const chatId = msg.chat.id;
  const waiting = await bot.sendMessage(chatId, isStealthMode() ? '■ 시스템 상태 확인 중...' : '🔎 시스템 상태 확인 중...');
  try {
    const snapshot = await HealthService.getSnapshot();
    const stealth = isStealthMode();
    const mark = (state) => stealth ? PLAIN[state] : ICONS[state];
    let text = `${uiTitle('🩺', 'Agent Hub Health')}\n\n`;
    text += `${mark(snapshot.state)} **Overall: ${snapshot.state}**\n\n`;
    for (const item of snapshot.checks) text += `${mark(item.state)} **${item.name}** — ${escapeMd(item.detail)}\n`;
    text += `\nChecked: \`${snapshot.checkedAt}\``;
    await bot.editMessageText(text, { chat_id: chatId, message_id: waiting.message_id, parse_mode: 'Markdown' });
  } catch (error) {
    await bot.editMessageText(`${isStealthMode() ? '[ERR]' : '❌'} Health check 실패: ${error.message}`, { chat_id: chatId, message_id: waiting.message_id }).catch(() => {});
  }
}
function escapeMd(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
