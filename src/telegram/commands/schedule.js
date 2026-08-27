import crypto from 'crypto';
import { getDb } from '../../database/index.js';
import { SessionManager } from '../../sessions/session-manager.js';
import { getSettingsManager } from '../../settings/settings-manager.js';
import { extractScheduleIntent } from '../../scheduler/intent.js';
import { computeNextRun } from '../../scheduler/types.js';
import { schedulerEngine } from '../../scheduler/engine.js';

const pending = new Map();
const PAGE_SIZE = 5;
function phase10Setting(key, fallback) { try { return getSettingsManager().get(key); } catch { return fallback; } }
function stealth() { return phase10Setting('stealth_mode', 'NORMAL') === 'STEALTH'; }
function icon(normal, plain = '') { return stealth() ? plain : normal; }

export async function handleScheduleCommand(bot, msg, args = '') {
  const chatId = msg.chat.id; const userId = msg.from.id; const text = args.trim();
  if (!text) return showScheduleList(bot, chatId, userId, null, 0);
  if (text === 'help') return bot.sendMessage(chatId, scheduleHelp(), { parse_mode: 'Markdown' });
  const active = SessionManager.getActiveSession(userId);
  const timezone = phase10Setting('timezone', 'Asia/Seoul');
  const wait = await bot.sendMessage(chatId, `${icon('⏳ ')}스케줄 요청을 해석하고 있습니다...`);
  try {
    const intent = await extractScheduleIntent(text, active, timezone); const next = computeNextRun(intent.schedule_type, intent.schedule_value, intent.timezone, new Date()); if (!next) throw new Error('다음 실행 시각이 미래가 아닙니다.');
    const token = crypto.randomUUID().slice(0, 12); pending.set(token, { userId, intent, expiresAt: Date.now() + 10 * 60 * 1000 });
    const body = `${icon('🗓️ ')}**스케줄 등록 확인**\n\n• 이름: **${escapeMd(intent.name)}**\n• 방식: \`${intent.schedule_type}\` / \`${intent.schedule_value}\`\n• Timezone: \`${intent.timezone}\`\n• 다음 실행: \`${formatDate(next, intent.timezone)}\`\n• Provider: \`${intent.provider}\`\n• Model: \`${intent.model || 'CLI Default'}\`\n• Timeout: \`${intent.timeout_seconds}s\`\n\n**작업**\n${escapeMd(intent.prompt)}\n\n등록할까요?`;
    await bot.editMessageText(body, { chat_id: chatId, message_id: wait.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: `${icon('✅ ')}등록`, callback_data: `schedule_confirm:${token}` }, { text: `${icon('❌ ')}취소`, callback_data: `schedule_cancel:${token}` }]] } });
  } catch (error) { await bot.editMessageText(`${icon('❌ ')}스케줄 해석 실패\n\n${error.message}\n\n${scheduleHelp(false)}`, { chat_id: chatId, message_id: wait.message_id }); }
}

export async function handleScheduleCallback(bot, q) {
  const data = q.data; const chatId = q.message.chat.id; const userId = q.from.id; await bot.answerCallbackQuery(q.id).catch(() => {});
  if (data.startsWith('schedule_confirm:')) { const token = data.split(':')[1]; const item = pending.get(token); if (!item || item.userId !== userId || item.expiresAt < Date.now()) return bot.sendMessage(chatId, `${icon('❌ ')}등록 요청이 만료되었습니다. 다시 입력해주세요.`); pending.delete(token); const s = createSchedule(userId, item.intent); return bot.editMessageText(`${icon('✅ ')}스케줄 등록 완료\n\n${s.name}\n다음 실행: ${formatDate(new Date(s.next_run_at), s.timezone)}`, { chat_id: chatId, message_id: q.message.message_id }); }
  if (data.startsWith('schedule_cancel:')) { pending.delete(data.split(':')[1]); return bot.editMessageText('스케줄 등록을 취소했습니다.', { chat_id: chatId, message_id: q.message.message_id }); }
  if (data.startsWith('schedule_page:')) return showScheduleList(bot, chatId, userId, q.message.message_id, Number(data.split(':')[1]) || 0);
  if (data.startsWith('schedule_back:')) return showScheduleList(bot, chatId, userId, q.message.message_id, Number(data.split(':')[1]) || 0);
  const [action, id, pageRaw] = data.split(':'); const page = Number(pageRaw) || 0; const s = getDb().prepare(`SELECT * FROM schedules WHERE id=? AND user_id=? AND kind='USER'`).get(id, userId); if (!s) return bot.sendMessage(chatId, `${icon('❌ ')}스케줄을 찾을 수 없습니다.`);
  if (action === 'schedule_open') return showScheduleDetail(bot, chatId, s, q.message.message_id, page);
  if (action === 'schedule_toggle') { getDb().prepare(`UPDATE schedules SET enabled=CASE enabled WHEN 1 THEN 0 ELSE 1 END,updated_at=datetime('now') WHERE id=?`).run(id); return showScheduleDetail(bot, chatId, getSchedule(id, userId), q.message.message_id, page); }
  if (action === 'schedule_delete') { getDb().prepare('DELETE FROM schedules WHERE id=?').run(id); return showScheduleList(bot, chatId, userId, q.message.message_id, page); }
  if (action === 'schedule_run') { await bot.editMessageText(`${icon('▶️ ')}**수동 실행 요청됨**\n\n${escapeMd(s.name)}\n\n스케줄 활성/비활성 상태는 변경하지 않습니다.`, { chat_id: chatId, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: `${icon('◀ ')}상세`, callback_data: `schedule_open:${s.id}:${page}` }]] } }).catch(() => {}); schedulerEngine.runNow(id, userId).catch((error) => console.error(`[Schedule Manual Run] ${id}: ${error.message}`)); return; }
  if (action === 'schedule_history') return showHistory(bot, chatId, s, q.message.message_id, page);
}

function createSchedule(userId, i) { const db = getDb(); const id = crypto.randomUUID(); const next = computeNextRun(i.schedule_type, i.schedule_value, i.timezone, new Date()); db.prepare(`INSERT INTO schedules(id,user_id,name,kind,schedule_type,schedule_value,timezone,provider,model,execution_profile,prompt,timeout_seconds,enabled,overlap_policy,next_run_at) VALUES(?,?,?,'USER',?,?,?,?,?,?,?,?,1,'SKIP',?)`).run(id, userId, i.name, i.schedule_type, i.schedule_value, i.timezone, i.provider, i.model, i.execution_profile, i.prompt, i.timeout_seconds, next.toISOString()); return getSchedule(id, userId); }
function getSchedule(id, userId) { return getDb().prepare(`SELECT * FROM schedules WHERE id=? AND user_id=? AND kind='USER'`).get(id, userId); }
async function showScheduleList(bot, chatId, userId, messageId = null, requestedPage = 0) { const db = getDb(); const total = db.prepare(`SELECT COUNT(*) AS c FROM schedules WHERE user_id=? AND kind='USER'`).get(userId).c; const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE)); const page = Math.min(Math.max(0, requestedPage), pageCount - 1); const rows = db.prepare(`SELECT * FROM schedules WHERE user_id=? AND kind='USER' ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(userId, PAGE_SIZE, page * PAGE_SIZE); let text = `${icon('🗓️ ')}**예약 작업**\n\n총 ${total}개 · ${page + 1}/${pageCount} 페이지\n\n`; const buttons = []; if (!rows.length) text += `등록된 작업이 없습니다.\n\n${scheduleHelp(false)}`; rows.forEach((s, index) => { text += `${s.enabled ? icon('🟢 ', '[ON] ') : icon('⚪ ', '[OFF] ')}**${escapeMd(s.name)}**\n   ${escapeMd(s.provider)} · 다음: ${s.next_run_at ? escapeMd(formatDate(new Date(s.next_run_at), s.timezone)) : '없음'}\n\n`; buttons.push([{ text: `${page * PAGE_SIZE + index + 1}. ${s.enabled ? icon('🟢 ', '[ON] ') : icon('⚪ ', '[OFF] ')}${truncate(s.name, 28)}`, callback_data: `schedule_open:${s.id}:${page}` }]); }); if (pageCount > 1) { const nav = []; if (page > 0) nav.push({ text: `${icon('◀️ ')}이전`, callback_data: `schedule_page:${page - 1}` }); nav.push({ text: `${page + 1} / ${pageCount}`, callback_data: `schedule_page:${page}` }); if (page < pageCount - 1) nav.push({ text: `다음${icon(' ▶️')}`, callback_data: `schedule_page:${page + 1}` }); buttons.push(nav); } const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }; if (messageId) return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts }).catch(() => {}); return bot.sendMessage(chatId, text, opts); }
async function showScheduleDetail(bot, chatId, s, messageId, page) { const text = `${icon('🗓️ ')}**예약 작업 상세**\n\n${s.enabled ? icon('🟢 활성', '[ON] 활성') : icon('⚪ 비활성', '[OFF] 비활성')} · **${escapeMd(s.name)}**\n\n• 방식: \`${s.schedule_type}\` / \`${escapeMd(s.schedule_value)}\`\n• Provider: \`${escapeMd(s.provider)}\`\n• Model: \`${escapeMd(s.model || 'CLI Default')}\`\n• Timezone: \`${escapeMd(s.timezone)}\`\n• Timeout: \`${s.timeout_seconds}s\`\n• 다음 실행: ${s.next_run_at ? `\`${escapeMd(formatDate(new Date(s.next_run_at), s.timezone))}\`` : '`없음`'}\n\n**작업**\n${escapeMd(s.prompt || '')}`; const buttons = [[{ text: s.enabled ? `${icon('⏸️ ')}끄기` : `${icon('▶️ ')}켜기`, callback_data: `schedule_toggle:${s.id}:${page}` }, { text: `${icon('▶️ ')}지금 실행`, callback_data: `schedule_run:${s.id}:${page}` }],[{ text: `${icon('📜 ')}기록`, callback_data: `schedule_history:${s.id}:${page}` }, { text: `${icon('🗑️ ')}삭제`, callback_data: `schedule_delete:${s.id}:${page}` }],[{ text: `${icon('◀ ')}목록`, callback_data: `schedule_back:${page}` }]]; return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }).catch(() => {}); }
async function showHistory(bot, chatId, s, messageId, page) { const runs = getDb().prepare(`SELECT * FROM schedule_runs WHERE schedule_id=? ORDER BY created_at DESC LIMIT 5`).all(s.id); let text = `${icon('📜 ')}**${escapeMd(s.name)} 최근 실행**\n\n`; text += runs.length ? runs.map((r) => `• \`${r.status}\` ${escapeMd(r.created_at)}${r.job_id ? `\n  Job: \`${escapeMd(r.job_id.slice(0, 8))}…\`` : ''}${r.error_message ? `\n  ${escapeMd(r.error_message.slice(0, 150))}` : ''}${r.output_summary ? `\n  ${escapeMd(r.output_summary.slice(0, 200))}` : ''}`).join('\n\n') : '실행 기록이 없습니다.'; return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: `${icon('◀ ')}상세`, callback_data: `schedule_open:${s.id}:${page}` }]] } }).catch(() => {}); }
function formatDate(d, tz) { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' }).format(d); } catch { return d.toISOString(); } }
function escapeMd(v) { return String(v ?? '').replace(/([_*`\[])/g, '\\$1'); }
function truncate(v, max) { const s = String(v ?? ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; }
function scheduleHelp(markdown = true) { const s = '사용법: /schedule 매 10분마다 서버 상태 확인\n예: /schedule 매일 오전 8시 오늘 할 일 정리'; return markdown ? `**${s}**` : s; }
