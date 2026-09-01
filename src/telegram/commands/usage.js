import { getDb } from '../../database/index.js';
import { providerManager, usageQuotaService } from '../../providers/provider-manager.js';
import { isStealthMode, uiTitle } from '../renderer/ui-theme.js';

function fmtMs(ms) { const sec = Math.round(Number(ms || 0) / 1000); if (sec < 60) return `${sec}s`; return `${Math.floor(sec / 60)}m ${sec % 60}s`; }
function esc(v) { return String(v ?? '').replace(/([_*`\[])/g, '\\$1'); }
function kst(iso) { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); } catch { return '미제공'; } }
function relative(iso) { const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000); if (!Number.isFinite(seconds)) return null; if (seconds <= 0) return 'reset 시각 지남'; const mins = Math.ceil(seconds / 60); if (mins < 60) return `${mins}분 후`; const hours = Math.floor(mins / 60), rem = mins % 60; if (hours < 24) return `${hours}시간 ${rem}분 후`; return `${Math.floor(hours / 24)}일 ${hours % 24}시간 후`; }

export function renderQuota(result) {
  const provider = result.provider.toUpperCase();
  let text = `\`[${esc(provider)}]\` · \`${esc(result.status)}\`${result.stale ? ' · `STALE`' : ''}\n\n`;
  if (result.status === 'UNAVAILABLE') {
    const reason = 'Provider가 조회 가능한 quota를 반환하지 않음';
    return `${text}${reason}\n`;
  }
  if (result.status === 'ERROR') return `${text}조회 실패\n${esc(result.error || '알 수 없는 오류')}\n`;
  const windows = [];
  let currentGroup = null;
  for (const window of result.windows) {
    if (window.group && window.group !== currentGroup) {
      windows.push(`◆ *${esc(window.group)}*`);
      currentGroup = window.group;
    }
    const usage = window.remainingPercent !== undefined
      ? `${window.remainingPercent}% 남음`
      : window.usedPercent !== undefined ? `${window.usedPercent}% 사용` : '사용률 미제공';
    const reset = window.resetsAt ? `${kst(window.resetsAt)} (${relative(window.resetsAt)})` : '미제공';
    windows.push(`**${esc(window.label)}**\n${esc(usage)}\nReset ${esc(reset)}`);
  }
  text += `${windows.join('\n\n')}\n\n조회 ${esc(kst(result.fetchedAt))}\nCache \`${esc(result.cache)}\`\n`;
  if (result.error) text += `최신 조회 오류\n${esc(result.error)}\n`;
  return text;
}

async function buildUsageText(userId, forceRefresh) {
  const db = getDb();
  const totals = db.prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(duration_ms),0) AS duration_ms FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='COMPLETED'`).get(userId);
  const providers = db.prepare(`SELECT j.provider, COUNT(*) AS runs, COALESCE(SUM(j.duration_ms),0) AS duration_ms FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='COMPLETED' GROUP BY j.provider ORDER BY runs DESC`).all(userId);
  const models = db.prepare(`SELECT COALESCE(j.model,'CLI Default') AS model, COUNT(*) AS runs FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='COMPLETED' GROUP BY COALESCE(j.model,'CLI Default') ORDER BY runs DESC LIMIT 10`).all(userId);
  const quotas = await Promise.all(providerManager.listProviderNames().map(name => usageQuotaService.get(name, { forceRefresh })));
  let text = `${uiTitle('📊', 'Agent Hub Usage')}\n\n\`[JOB]\`\n\n완료 작업 **${totals.runs}회**\n실행 시간 합계 **${fmtMs(totals.duration_ms)}**\n\n\`[PROVIDER]\`\n\n`;
  text += providers.length ? providers.map(r => `• ${esc(r.provider)}: ${r.runs}회 / ${fmtMs(r.duration_ms)}`).join('\n\n') : '• 기록 없음';
  text += `\n\n\`[MODEL]\`\n\n${models.length ? models.map(r => `• ${esc(r.model)}: ${r.runs}회`).join('\n\n') : '• 기록 없음'}`;
  text += `\n\n${quotas.map(renderQuota).join('\n')}\n_${isStealthMode() ? '미제공 수치는 추정하지 않습니다.' : 'ℹ️ 미제공 수치는 추정하지 않습니다.'}_`;
  return text;
}

export async function handleUsageCommand(bot, msg, { forceRefresh = false } = {}) {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id;
  const userId = msg.from.id;
  const isCallback = Boolean(msg.message && !msg.chat);
  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: isStealthMode() ? '↻ quota 새로고침' : '🔄 quota 새로고침', callback_data: 'usage_refresh' }]] } };

  if (isCallback) {
    const text = await buildUsageText(userId, forceRefresh);
    return bot.editMessageText(text, { chat_id: chatId, message_id: msg.message.message_id, ...options });
  }

  const waiting = await bot.sendMessage(chatId, isStealthMode() ? '■ Usage 확인 중...' : '🔎 Usage 확인 중...');
  try {
    const text = await buildUsageText(userId, forceRefresh);
    return await bot.editMessageText(text, { chat_id: chatId, message_id: waiting.message_id, ...options });
  } catch (error) {
    await bot.editMessageText(`${isStealthMode() ? '[ERR]' : '❌'} Usage 조회 실패: ${error.message}`, {
      chat_id: chatId,
      message_id: waiting.message_id
    }).catch(() => {});
    return null;
  }
}

export async function handleUsageCallback(bot, query) { await handleUsageCommand(bot, query, { forceRefresh: true }); await bot.answerCallbackQuery(query.id, { text: 'Provider quota를 새로고침했습니다.' }); }
