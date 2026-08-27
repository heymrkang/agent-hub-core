import fs from 'fs';
import path from 'path';
import { HealthService } from '../../health/health-service.js';
import { getDb } from '../../database/index.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { isStealthMode, uiTitle } from '../renderer/ui-theme.js';

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

export async function handleStatusCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const waiting = await bot.sendMessage(chatId, isStealthMode() ? '■ 시스템 상태 확인 중...' : '🔎 시스템 상태 확인 중...');
  try {
    const snapshot = await HealthService.getSnapshot();
    const stealth = isStealthMode();
    const mark = (state) => stealth ? PLAIN[state] : ICONS[state];
    const session = SessionManager.getActiveSession(userId);
    const activeJob = getDb().prepare(`SELECT id,status,provider,model,type,started_at,queued_at FROM jobs WHERE session_id=? AND status IN ('QUEUED','RUNNING') ORDER BY created_at DESC LIMIT 1`).get(session.id);
    const recentFailure = getDb().prepare(`SELECT j.error_category,j.error_message,j.created_at AS created_at FROM jobs j JOIN sessions s ON s.id=j.session_id WHERE s.user_id=? AND j.status='FAILED' ORDER BY j.created_at DESC LIMIT 1`).get(userId);

    let text = `${uiTitle('🩺', 'Agent Hub Health')}\n\n`;
    text += `App: \`v${escapeMd(appVersion())}\` · DB schema: \`v${schemaVersion()}\`\n`;
    text += `${mark(snapshot.state)} **Overall: ${snapshot.state}**\n\n`;
    for (const item of snapshot.checks) text += `${mark(item.state)} **${item.name}** — ${escapeMd(item.detail)}\n`;
    text += `\n**Active Session**\n`;
    text += `Title: ${escapeMd(session.title)}\nProvider: ${escapeMd(session.active_provider)}\nModel: ${escapeMd(session.active_model || 'CLI Default')}\nProfile: ${escapeMd(session.execution_profile)}\n`;
    text += `Job: ${activeJob ? `${escapeMd(activeJob.status)} · ${escapeMd(activeJob.type)} · ${escapeMd(activeJob.id)}` : 'idle'}\n`;
    if (recentFailure) text += `\n**Recent Failure**\n${escapeMd(recentFailure.error_category || 'UNKNOWN')} · ${escapeMd(recentFailure.created_at)}\n${escapeMd(String(recentFailure.error_message || '').slice(0, 500))}\n`;
    text += `\nChecked: \`${snapshot.checkedAt}\``;
    await bot.editMessageText(text, { chat_id: chatId, message_id: waiting.message_id, parse_mode: 'Markdown' });
  } catch (error) {
    await bot.editMessageText(`${isStealthMode() ? '[ERR]' : '❌'} Health check 실패: ${error.message}`, { chat_id: chatId, message_id: waiting.message_id }).catch(() => {});
  }
}
function escapeMd(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
