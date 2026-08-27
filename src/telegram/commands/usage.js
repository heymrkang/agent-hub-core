import { getDb } from '../../database/index.js';
import { providerManager } from '../../providers/provider-manager.js';
import { isStealthMode, uiTitle } from '../renderer/ui-theme.js';

function fmtMs(ms) {
  const value = Number(ms || 0);
  if (!value) return '0s';
  const sec = Math.round(value / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60); const rem = sec % 60;
  return `${min}m ${rem}s`;
}
function esc(v) { return String(v ?? '').replace(/([_*`\[])/g, '\\$1'); }

export async function handleUsageCommand(bot, msg) {
  const db = getDb();
  const userId = msg.from.id;
  const totals = db.prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(duration_ms),0) AS duration_ms FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='COMPLETED'`).get(userId);
  const providers = db.prepare(`SELECT j.provider, COUNT(*) AS runs, COALESCE(SUM(j.duration_ms),0) AS duration_ms FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='COMPLETED' GROUP BY j.provider ORDER BY runs DESC`).all(userId);
  const models = db.prepare(`SELECT COALESCE(j.model,'CLI Default') AS model, COUNT(*) AS runs FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='COMPLETED' GROUP BY COALESCE(j.model,'CLI Default') ORDER BY runs DESC LIMIT 10`).all(userId);

  let text = `${uiTitle('📊', 'Agent Hub Usage')}\n\n`;
  text += `완료 작업: **${totals.runs}회**\n실행 시간 합계: **${fmtMs(totals.duration_ms)}**\n\n`;
  text += `**Provider 분포**\n`;
  text += providers.length ? providers.map((r) => `• ${esc(r.provider)}: ${r.runs}회 / ${fmtMs(r.duration_ms)}`).join('\n') : '• 기록 없음';
  text += `\n\n**Model 분포**\n`;
  text += models.length ? models.map((r) => `• ${esc(r.model)}: ${r.runs}회`).join('\n') : '• 기록 없음';
  text += `\n\n**Provider quota / token**\n`;
  for (const name of providerManager.listProviderNames()) text += `• ${esc(name)}: CLI가 신뢰 가능한 quota/window/token 수치를 현재 노출하지 않아 표시하지 않음\n`;
  text += `\n_${isStealthMode() ? '미제공 수치는 추정하지 않습니다.' : 'ℹ️ 미제공 수치는 추정하지 않습니다.'}_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}
