import { ACTIVE_PREVIEW_STATUSES } from '../../preview/preview-registry.js';
import { getPreviewService } from '../../preview/preview-service.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { getSettingsManager } from '../../settings/settings-manager.js';
import { isStealthMode } from '../renderer/ui-theme.js';

function escapeMarkdown(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
function sourceInfo(source) { return { chatId: source.chat ? source.chat.id : source.message.chat.id, messageId: source.chat ? null : source.message?.message_id }; }

export function parsePreviewStartArgs(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('사용법: /preview start <절대경로> [--port N]');
  const match = value.match(/^(.*?)(?:\s+--port\s+(\d+))?$/);
  const workspacePath = match?.[1]?.trim();
  const manualPort = match?.[2] === undefined ? null : Number(match[2]);
  if (!workspacePath?.startsWith('/')) throw new Error('Workspace 절대경로가 필요합니다.');
  if (manualPort !== null && (!Number.isInteger(manualPort) || manualPort < 1 || manualPort > 65535)) throw new Error('port는 1~65535 범위여야 합니다.');
  return { workspacePath, manualPort };
}

function uptime(preview) {
  if (!preview.started_at) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(`${preview.started_at}Z`).getTime()) / 1000));
  if (seconds < 60) return `${seconds}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
}

async function sendOrEdit(bot, source, text, keyboard) {
  const { chatId, messageId } = sourceInfo(source);
  const options = { parse_mode: 'Markdown', disable_web_page_preview: true, reply_markup: { inline_keyboard: keyboard } };
  if (!messageId) return bot.sendMessage(chatId, text, options);
  return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }).catch((error) => {
    if (!/message is not modified/i.test(error.message)) throw error;
  });
}

async function renderList(bot, source, services) {
  const active = services.registry.list({ limit: 30 }).filter((item) => ACTIVE_PREVIEW_STATUSES.includes(item.status));
  const max = getSettingsManager().get('preview_max_concurrent');
  const lines = active.length ? active.map((item) => `• **${escapeMarkdown(item.project_name)}** · \`${item.status}\`\n  \`${item.public_hostname}\``).join('\n\n') : '실행 중인 Preview 없음.';
  const keyboard = active.map((item) => [{ text: `${item.status === 'RUNNING' ? '●' : '○'} ${item.project_name}`, callback_data: `preview_detail:${item.id}` }]);
  keyboard.push([{ text: '새로고침', callback_data: 'preview_list' }]);
  return sendOrEdit(bot, source, `${isStealthMode() ? '■' : '🖥'} **Preview · ${active.length}/${max}**\n\n${lines}\n\n시작: \`/preview start /home/dev/workspace/프로젝트\``, keyboard);
}

async function renderDetail(bot, source, preview, services) {
  const running = preview.status === 'RUNNING';
  const failure = preview.failure_reason ? `\n오류: ${escapeMarkdown(preview.failure_reason).slice(0, 500)}` : '';
  const text = `${isStealthMode() ? '■' : '🖥'} **Preview · ${escapeMarkdown(preview.project_name)}**\n\n상태: \`${preview.status}\`\nURL: ${preview.public_url}\nPort: \`${preview.port ?? '-'}\`\nUptime: \`${uptime(preview)}\`${failure}`;
  const keyboard = [];
  if (running) keyboard.push([{ text: '🌐 열기', url: preview.public_url }]);
  if (running) keyboard.push([{ text: '↻ 재시작', callback_data: `preview_restart:${preview.id}` }, { text: '📋 로그', callback_data: `preview_logs:${preview.id}` }]);
  if (ACTIVE_PREVIEW_STATUSES.includes(preview.status) || preview.status === 'FAILED') keyboard.push([{ text: '■ 종료', callback_data: `preview_stop:${preview.id}` }]);
  keyboard.push([{ text: '‹ 목록', callback_data: 'preview_list' }]);
  return sendOrEdit(bot, source, text, keyboard);
}

export async function handlePreviewCommand(bot, msg, rawArgs = '', dependencies = null) {
  try {
    const services = dependencies || getPreviewService();
    const args = String(rawArgs || '').trim();
    if (!args) return renderList(bot, msg, services);
    if (!args.startsWith('start ')) throw new Error('지원 명령: /preview, /preview start <절대경로> [--port N]');
    const { workspacePath, manualPort } = parsePreviewStartArgs(args.slice(6));
    const session = SessionManager.getActiveSession(msg.from.id);
    const detectedRuntime = services.detector.detect({ workspacePath });
    await bot.sendMessage(msg.chat.id, `${isStealthMode() ? '>' : '⏳'} Preview 시작 중: \`${escapeMarkdown(detectedRuntime.projectName)}\``, { parse_mode: 'Markdown' });
    const preview = await services.manager.start({ sessionId: session.id, detectedRuntime, manualPort });
    return renderDetail(bot, msg, preview, services);
  } catch (error) {
    return bot.sendMessage(msg.chat.id, `${isStealthMode() ? '×' : '❌'} Preview 실패: ${error.message}`);
  }
}

export async function handlePreviewCallback(bot, q, dependencies = null) {
  const services = dependencies || getPreviewService();
  const data = q.data || '';
  try {
    await bot.answerCallbackQuery(q.id).catch(() => {});
    if (data === 'preview_list') return renderList(bot, q, services);
    const separator = data.indexOf(':');
    if (separator < 1) return;
    const action = data.slice(0, separator);
    const id = data.slice(separator + 1);
    if (action === 'preview_detail') return renderDetail(bot, q, services.registry.require(id), services);
    if (action === 'preview_restart') return renderDetail(bot, q, await services.manager.restart(id), services);
    if (action === 'preview_stop') { await services.manager.stop(id); return renderList(bot, q, services); }
    if (action === 'preview_logs') {
      const output = (await services.manager.logs(id, { tail: 80 })).trim() || '(로그 없음)';
      await bot.sendMessage(q.message.chat.id, `📋 **Preview 로그**\n\n\`\`\`\n${output.replace(/```/g, '~~~').slice(-3500)}\n\`\`\``, { parse_mode: 'Markdown' });
      return renderDetail(bot, q, services.registry.require(id), services);
    }
  } catch (error) {
    await bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`.slice(0, 180), show_alert: true }).catch(() => {});
  }
}
