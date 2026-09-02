import { ACTIVE_PREVIEW_STATUSES } from '../../preview/preview-registry.js';
import { getPreviewService } from '../../preview/preview-service.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { getSettingsManager } from '../../settings/settings-manager.js';
import { resolveRepositoryPath } from '../../git/git-manager.js';
import { isStealthMode } from '../renderer/ui-theme.js';

function escapeMarkdown(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
function sourceInfo(source) { return { chatId: source.chat ? source.chat.id : source.message.chat.id, messageId: source.chat ? null : source.message?.message_id }; }

function runtimeLabel(preview) {
  const framework = ({ NESTJS: 'NestJS', NEXTJS: 'Next.js', VITE: 'Vite' })[preview.framework] || preview.framework || preview.runtime_type || 'UNKNOWN';
  return `${framework} / Port ${preview.port ?? '-'}`;
}

export function buildPreviewEndpointUrl(preview, endpointPath = '/') {
  const path = String(endpointPath || '');
  if (!preview?.public_url || !path.startsWith('/') || path.startsWith('//') || /[\\\s?#]/.test(path)) return null;
  try {
    const origin = new URL(preview.public_url);
    const url = new URL(path, origin);
    return origin.protocol === 'https:' && url.origin === origin.origin ? url.toString() : null;
  } catch {
    return null;
  }
}

export function formatDetectedRuntime(detectedRuntime) {
  const command = [detectedRuntime.command.executable, ...detectedRuntime.command.args].join(' ');
  return `Runtime: \`${escapeMarkdown(detectedRuntime.runtimeType)} / ${escapeMarkdown(detectedRuntime.framework || 'UNKNOWN')}\`\nCommand: \`${escapeMarkdown(command)}\``;
}

export function parsePreviewStartArgs(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('사용법: /preview start <레포명> [--port N]');
  const match = value.match(/^(.*?)(?:\s+--port\s+(\d+))?$/);
  const repositoryName = match?.[1]?.trim();
  const manualPort = match?.[2] === undefined ? null : Number(match[2]);
  if (!repositoryName) throw new Error('레포명이 필요합니다.');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(repositoryName)) throw new Error('레포명은 영문, 숫자, 점, 밑줄, 대시만 사용할 수 있습니다.');
  if (manualPort !== null && (!Number.isInteger(manualPort) || manualPort < 1 || manualPort > 65535)) throw new Error('port는 1~65535 범위여야 합니다.');
  return { repositoryName, manualPort };
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
  const active = services.registry.list({ userId: source.from?.id, limit: 30 }).filter((item) => ACTIVE_PREVIEW_STATUSES.includes(item.status));
  const max = getSettingsManager().get('preview_max_concurrent');
  const lines = active.length ? active.map((item) => {
    const kind = item.runtime_type === 'BACKEND_API' ? `API · ${escapeMarkdown(({ NESTJS: 'NestJS' })[item.framework] || item.framework || 'Backend')}` : 'Web';
    return `• **${escapeMarkdown(item.project_name)}** · \`${item.status}\` · ${kind}\n  \`${item.public_hostname}\``;
  }).join('\n\n') : '실행 중인 Preview 없음.';
  const keyboard = active.map((item) => [{ text: `${item.status === 'RUNNING' ? '●' : '○'} ${item.project_name}`, callback_data: `preview_detail:${item.id}` }]);
  keyboard.push([{ text: '새로고침', callback_data: 'preview_list' }]);
  return sendOrEdit(bot, source, `${isStealthMode() ? '■' : '🖥'} **Preview · ${active.length}/${max}**\n\n${lines}\n\n시작: \`/preview start 레포명\``, keyboard);
}

async function renderDetail(bot, source, preview, services) {
  const running = preview.status === 'RUNNING';
  const backendApi = preview.runtime_type === 'BACKEND_API';
  const failure = preview.failure_reason ? `\n오류: ${escapeMarkdown(preview.failure_reason).slice(0, 500)}` : '';
  const urlLine = `URL: ${preview.public_url}`;
  const openapi = preview.openapi_ui_path || preview.openapi_json_path
    ? [preview.openapi_ui_path && `UI \`${escapeMarkdown(preview.openapi_ui_path)}\``, preview.openapi_json_path && `JSON \`${escapeMarkdown(preview.openapi_json_path)}\``].filter(Boolean).join(' · ')
    : '`미탐지`';
  const apiDetails = backendApi
    ? `\nRuntime: \`${escapeMarkdown(runtimeLabel(preview))}\`\nOpenAPI: ${openapi}\nHealth: ${preview.health_path ? `\`${escapeMarkdown(preview.health_path)}\`` : '`미탐지`'}\n데이터 대상: \`dev 전용\`\n${isStealthMode() ? '!' : '⚠️'} 문서/API 요청은 개발 데이터를 실제 변경할 수 있음.`
    : `\nPort: \`${preview.port ?? '-'}\``;
  const title = backendApi ? 'API Preview' : 'Preview';
  const text = `${isStealthMode() ? '■' : backendApi ? '🧩' : '🖥'} **${title} · ${escapeMarkdown(preview.project_name)}**\n\n상태: \`${preview.status}\`\n${urlLine}${apiDetails}\nUptime: \`${uptime(preview)}\`${failure}`;
  const keyboard = [];
  if (running) {
    keyboard.push([{ text: backendApi ? '🌐 API 열기' : '🌐 열기', url: preview.public_url }]);
    if (backendApi) {
      const endpoints = [];
      const openapiUiUrl = buildPreviewEndpointUrl(preview, preview.openapi_ui_path);
      const openapiJsonUrl = buildPreviewEndpointUrl(preview, preview.openapi_json_path);
      const healthUrl = buildPreviewEndpointUrl(preview, preview.health_path);
      if (openapiUiUrl) endpoints.push({ text: '📚 API 문서', url: openapiUiUrl });
      if (openapiJsonUrl) endpoints.push({ text: '🧾 OpenAPI JSON', url: openapiJsonUrl });
      if (endpoints.length) keyboard.push(endpoints);
      if (healthUrl) keyboard.push([{ text: '🩺 Health 확인', url: healthUrl }]);
    }
  }
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
    if (!args.startsWith('start ')) throw new Error('지원 명령: /preview, /preview start <레포명> [--port N]');
    const { repositoryName, manualPort } = parsePreviewStartArgs(args.slice(6));
    const session = SessionManager.getActiveSession(msg.from.id);
    const workspacePath = resolveRepositoryPath(repositoryName);
    const detectedRuntime = services.detector.detect({ workspacePath });
    await bot.sendMessage(msg.chat.id, `${isStealthMode() ? '>' : '⏳'} Preview 시작 중: \`${escapeMarkdown(detectedRuntime.projectName)}\`\n${formatDetectedRuntime(detectedRuntime)}`, { parse_mode: 'Markdown' });
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
    services.registry.requireOwned(id, q.from.id);
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
