import fs from 'fs';
import path from 'path';
import { HealthService } from '../../health/health-service.js';
import { getDb } from '../../database/index.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { isStealthMode } from '../renderer/ui-theme.js';
import { providerManager, usageQuotaService } from '../../providers/provider-manager.js';

const ICONS = { HEALTHY: '✅', DEGRADED: '⚠️', ERROR: '❌' };
const PLAIN = { HEALTHY: '[OK]', DEGRADED: '[WARN]', ERROR: '[ERR]' };

function appVersion() {
  try { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')).version || 'unknown'; }
  catch { return 'unknown'; }
}
function schemaVersion() {
  try { return getDb().prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0; }
  catch { return 0; }
}

function kst(iso) {
  try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); }
  catch { return '미제공'; }
}

function renderProviderQuota(quota) {
  let text = `◆ *${escapeMd(quota.provider.toUpperCase())}* · \`${escapeMd(quota.status)}\`${quota.stale ? ' · `STALE`' : ''}\n`;
  let currentGroup = null;
  const windows = quota.windows.filter(window => window.remainingPercent !== undefined);
  for (const window of windows) {
    if (window.group && window.group !== currentGroup) {
      text += `\n◇ *${escapeMd(window.group)}*\n`;
      currentGroup = window.group;
    }
    text += `**${escapeMd(window.label)}** ${window.remainingPercent}% 남음\n`;
  }
  if (!windows.length) text += `${escapeMd(quota.status)}\n`;
  if (quota.fetchedAt) text += `조회 ${escapeMd(kst(quota.fetchedAt))}\n`;
  return text.trimEnd();
}

export function renderStatus({ snapshot, quotas, session, activeJob, recentFailure, version, schema, stealth = false }) {
  const mark = (state) => stealth ? PLAIN[state] : ICONS[state];
  let text = `${stealth ? '■' : '🩺'} Agent Hub Health\n\n`;
  text += '`[SUMMARY]`\n\n';
  text += `App \`v${escapeMd(version)}\`\n`;
  text += `DB schema \`v${escapeMd(schema)}\`\n`;
  text += `${mark(snapshot.state)} **Overall: ${snapshot.state}**\n\n`;
  text += '`[HEALTH CHECK]`\n\n';
  text += snapshot.checks.map(item => `${mark(item.state)} **${escapeMd(item.name)}**\n${escapeMd(item.detail)}`).join('\n\n');
  text += '\n\n`[ACTIVE SESSION]`\n\n';
  text += `Title: ${escapeMd(session.title)}\n`;
  text += `Provider: ${escapeMd(session.active_provider)}\n`;
  text += `Model: ${escapeMd(session.active_model || 'CLI Default')}\n`;
  text += `Thinking: ${escapeMd(session.reasoning_effort || 'default')}\n`;
  text += `Profile: ${escapeMd(session.execution_profile)}\n`;
  text += `Job: ${activeJob ? `${escapeMd(activeJob.status)} · ${escapeMd(activeJob.type)} · ${escapeMd(activeJob.id)}` : 'idle'}\n`;
  text += '\n`[PROVIDER QUOTA]`\n\n';
  text += quotas.map(renderProviderQuota).join('\n\n');
  text += '\n\n상세/새로고침: /usage\n';
  if (recentFailure) {
    text += '\n`[RECENT FAILURE]`\n\n';
    text += `**${escapeMd(recentFailure.error_category || 'UNKNOWN')}**\n`;
    text += `${escapeMd(recentFailure.created_at)}\n`;
    text += `${escapeMd(String(recentFailure.error_message || '').slice(0, 500))}\n`;
  }
  text += `\n\`[CHECKED]\`\n\n${escapeMd(kst(snapshot.checkedAt))}`;
  return text;
}

export async function handleStatusCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const waiting = await bot.sendMessage(chatId, isStealthMode() ? '■ 시스템 상태 확인 중...' : '🔎 시스템 상태 확인 중...');
  try {
    const [snapshot, quotas] = await Promise.all([
      HealthService.getSnapshot(),
      Promise.all(providerManager.listProviderNames().map(name => usageQuotaService.get(name)))
    ]);
    const session = SessionManager.getActiveSession(userId);
    const activeJob = getDb().prepare(`SELECT id,status,provider,model,type,started_at,queued_at FROM jobs WHERE session_id=? AND status IN ('QUEUED','RUNNING') ORDER BY created_at DESC LIMIT 1`).get(session.id);
    const recentFailure = getDb().prepare(`SELECT j.error_category,j.error_message,j.created_at AS created_at FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='FAILED' ORDER BY j.created_at DESC LIMIT 1`).get(userId);

    const text = renderStatus({ snapshot, quotas, session, activeJob, recentFailure, version: appVersion(), schema: schemaVersion(), stealth: isStealthMode() });
    await bot.editMessageText(text, { chat_id: chatId, message_id: waiting.message_id, parse_mode: 'Markdown' });
  } catch (error) {
    await bot.editMessageText(`${isStealthMode() ? '[ERR]' : '❌'} Health check 실패: ${error.message}`, { chat_id: chatId, message_id: waiting.message_id }).catch(() => {});
  }
}
function escapeMd(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
