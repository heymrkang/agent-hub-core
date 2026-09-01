import { SessionManager } from '../../sessions/session-manager.js';
import { formatKST } from '../../utils/date.js';
import { isStealthMode, uiStatusIcon, uiTitle } from '../renderer/ui-theme.js';

const PAGE_SIZE = 5;
const VALID_STATUSES = new Set(['ACTIVE', 'ARCHIVED', 'DELETED']);
function normalizeStatus(value) { return VALID_STATUSES.has(value) ? value : 'ACTIVE'; }
function shortTitle(title, max = 30) { const value = String(title || '새 채팅').replace(/\s+/g, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function escapeMarkdown(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
function md(value, max = null) { const text = max ? shortTitle(value, max) : String(value ?? ''); return escapeMarkdown(text); }
function tabLabel(status, current) { const labels = { ACTIVE: '활성', ARCHIVED: '보관함', DELETED: '휴지통' }; return status === current ? `✓ ${labels[status]}` : labels[status]; }
function nav(label, icon) { return `${isStealthMode() ? '' : `${icon} `}${label}`; }
function statusMark(enabled) { return enabled ? uiStatusIcon('active') : uiStatusIcon('inactive'); }
function isMessageNotModified(error) { return /message is not modified/i.test(String(error?.message || '')); }
async function editMessageIfChanged(bot, text, options) { try { return await bot.editMessageText(text, options); } catch (error) { if (isMessageNotModified(error)) return null; throw error; } }

async function renderSessions(bot, source, status = 'ACTIVE', page = 0) {
  status = normalizeStatus(status);
  const chatId = source.chat ? source.chat.id : source.message.chat.id;
  const userId = source.from.id;
  const activeSession = SessionManager.getActiveSession(userId);
  const sessions = SessionManager.listSessions(userId, status);
  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  page = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageItems = sessions.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const statusNames = { ACTIVE: '활성', ARCHIVED: '보관함', DELETED: '휴지통' };

  let text = `${uiTitle('📁', `세션 · ${statusNames[status]}`)}\n\n`;
  text += `현재: **${md(activeSession.title, 36)}**\n`;
  text += `Provider: ${md(activeSession.active_provider)}${activeSession.active_model ? ` · ${md(activeSession.active_model)}` : ''}\nThinking: ${md(activeSession.reasoning_effort || 'default')}\n\n`;
  if (!pageItems.length) text += `_${statusNames[status]}에 세션이 없습니다._`;
  else { text += `세션 ${sessions.length}개 · ${page + 1}/${totalPages} 페이지\n`; text += `_세션을 선택하면 관리 메뉴가 열립니다._`; }

  const keyboard = pageItems.map((session, index) => {
    const absoluteIndex = page * PAGE_SIZE + index + 1;
    const current = status === 'ACTIVE' && session.id === activeSession.id;
    const lock = session.title_locked ? (isStealthMode() ? ' [LOCK]' : ' 🔒') : '';
    return [{ text: `${current ? '● ' : ''}${absoluteIndex}. ${shortTitle(session.title)}${lock}`, callback_data: `session_info:${session.id}:${status}:${page}` }];
  });

  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) navRow.push({ text: nav('이전', '◀'), callback_data: `session_page:${status}:${page - 1}` });
    navRow.push({ text: `${page + 1} / ${totalPages}`, callback_data: 'session_noop' });
    if (page < totalPages - 1) navRow.push({ text: nav('다음', '▶'), callback_data: `session_page:${status}:${page + 1}` });
    keyboard.push(navRow);
  }

  keyboard.push([
    { text: tabLabel('ACTIVE', status), callback_data: 'session_page:ACTIVE:0' },
    { text: tabLabel('ARCHIVED', status), callback_data: 'session_page:ARCHIVED:0' },
    { text: tabLabel('DELETED', status), callback_data: 'session_page:DELETED:0' }
  ]);
  if (status === 'DELETED' && sessions.length > 0) keyboard.push([{ text: `${isStealthMode() ? '[DEL] ' : '🗑 ' }휴지통 비우기 (${sessions.length})`, callback_data: 'session_trash_confirm' }]);
  keyboard.push([{ text: `${isStealthMode() ? '+ ' : '＋ '}새 세션 만들기 (/new)`, callback_data: 'session_create_new' }]);

  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  if (!source.chat && source.message?.message_id) await editMessageIfChanged(bot, text, { chat_id: chatId, message_id: source.message.message_id, ...options });
  else await bot.sendMessage(chatId, text, options);
}

export async function handleSessionsCommand(bot, msg, status = 'ACTIVE', page = 0) {
  const chatId = msg.chat ? msg.chat.id : msg.message.chat.id;
  try { await renderSessions(bot, msg, status, page); }
  catch (error) { console.error(`[Command /sessions Error] ${error.message}`); await bot.sendMessage(chatId, `${uiStatusIcon('error')} 세션 목록 조회 실패: ${error.message}`); }
}

async function showSessionDetail(bot, callbackQuery, sessionId, returnStatus = null, returnPage = 0) {
  const chatId = callbackQuery.message.chat.id; const messageId = callbackQuery.message.message_id; const userId = callbackQuery.from.id;
  const session = SessionManager.getSession(sessionId);
  if (!session || session.user_id !== userId || session.is_system) { await bot.answerCallbackQuery(callbackQuery.id, { text: '세션을 찾을 수 없습니다.' }); return; }
  const activeSession = SessionManager.getActiveSession(userId); const isCurrent = session.id === activeSession.id;
  const status = normalizeStatus(returnStatus || session.status); const page = Math.max(Number(returnPage) || 0, 0);
  const statusNames = { ACTIVE: '활성', ARCHIVED: '보관함', DELETED: '휴지통' };

  let text = `${uiTitle('📄', md(session.title, 50))}\n\n`;
  text += `상태: ${statusNames[session.status] || md(session.status)}${isCurrent ? ' · 현재 세션' : ''}\n`;
  text += `Provider: ${md(session.active_provider)}${session.active_model ? ` · ${md(session.active_model)}` : ''}\nThinking: ${md(session.reasoning_effort || 'default')}\n`;
  text += `Profile: ${md(session.execution_profile)}\n`;
  text += `최근 활동: ${md(formatKST(session.updated_at))}\n`;
  if (session.title_locked) text += `제목: 사용자 지정${isStealthMode() ? ' [LOCK]' : ' 🔒'}\n`;

  const buttons = [];
  if (session.status === 'ACTIVE') {
    if (!isCurrent) buttons.push([{ text: '✓ 이 세션으로 전환', callback_data: `session_switch:${session.id}:${page}` }]);
    buttons.push([{ text: nav('보관', '📦'), callback_data: `session_archive:${session.id}:${page}` }, { text: nav('휴지통으로', '🗑'), callback_data: `session_delete:${session.id}:${page}` }]);
  } else if (session.status === 'ARCHIVED') buttons.push([{ text: nav('복구', '♻'), callback_data: `session_restore:${session.id}:ARCHIVED:${page}` }]);
  else if (session.status === 'DELETED') {
    buttons.push([{ text: nav('복구', '♻'), callback_data: `session_restore:${session.id}:DELETED:${page}` }]);
    buttons.push([{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}영구 삭제`, callback_data: `session_purge_confirm:${session.id}:${page}` }]);
  }
  buttons.push([{ text: '← 세션 목록', callback_data: `session_page:${status}:${page}` }]);
  await editMessageIfChanged(bot, text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
  await bot.answerCallbackQuery(callbackQuery.id);
}

async function confirmTrashEmpty(bot, callbackQuery) {
  const userId = callbackQuery.from.id; const count = SessionManager.countSessions(userId, 'DELETED');
  if (!count) { await bot.answerCallbackQuery(callbackQuery.id, { text: '휴지통이 비어 있습니다.' }); await renderSessions(bot, callbackQuery, 'DELETED', 0); return; }
  await editMessageIfChanged(bot, `${uiStatusIcon('warning')} **휴지통 비우기**\n\n휴지통의 세션 **${count}개**를 영구 삭제합니다.\n대화 기록과 해당 세션의 첨부파일도 함께 제거되며 복구할 수 없습니다.`, {
    chat_id: callbackQuery.message.chat.id, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}${count}개 영구 삭제`, callback_data: 'session_trash_empty' }],[{ text: '취소', callback_data: 'session_page:DELETED:0' }]] }
  });
  await bot.answerCallbackQuery(callbackQuery.id);
}

export async function handleSessionsCallback(bot, callbackQuery) {
  const data = callbackQuery.data; const userId = callbackQuery.from.id; const chatId = callbackQuery.message.chat.id;
  try {
    if (data === 'session_noop') { await bot.answerCallbackQuery(callbackQuery.id); return; }
    if (data.startsWith('session_tab:')) { const status = normalizeStatus(data.replace('session_tab:', '')); await renderSessions(bot, callbackQuery, status, 0); await bot.answerCallbackQuery(callbackQuery.id); return; }
    if (data.startsWith('session_page:')) { const [, status, page] = data.split(':'); await renderSessions(bot, callbackQuery, normalizeStatus(status), Number(page) || 0); await bot.answerCallbackQuery(callbackQuery.id); return; }
    if (data.startsWith('session_info:')) { const [, sessionId, status = 'ACTIVE', page = '0'] = data.split(':'); await showSessionDetail(bot, callbackQuery, sessionId, status, page); return; }
    if (data.startsWith('session_switch:')) { const [, sessionId, page = '0'] = data.split(':'); SessionManager.setActiveSession(userId, sessionId); const session = SessionManager.getSession(sessionId); await bot.answerCallbackQuery(callbackQuery.id, { text: `[${session?.title || '세션'}] (으)로 전환되었습니다.` }); await renderSessions(bot, callbackQuery, 'ACTIVE', Number(page) || 0); return; }
    if (data.startsWith('session_archive:')) { const [, sessionId, page = '0'] = data.split(':'); SessionManager.archiveSession(sessionId); await bot.answerCallbackQuery(callbackQuery.id, { text: '세션이 보관되었습니다.' }); await renderSessions(bot, callbackQuery, 'ACTIVE', Number(page) || 0); return; }
    if (data.startsWith('session_delete:')) { const [, sessionId, page = '0'] = data.split(':'); SessionManager.softDeleteSession(sessionId); await bot.answerCallbackQuery(callbackQuery.id, { text: '휴지통으로 이동했습니다. 30일간 복구할 수 있습니다.' }); await renderSessions(bot, callbackQuery, 'ACTIVE', Number(page) || 0); return; }
    if (data.startsWith('session_restore:')) { const [, sessionId, fromStatus = 'DELETED', page = '0'] = data.split(':'); SessionManager.restoreSession(sessionId); await bot.answerCallbackQuery(callbackQuery.id, { text: '세션을 복구했습니다.' }); await renderSessions(bot, callbackQuery, normalizeStatus(fromStatus), Number(page) || 0); return; }
    if (data.startsWith('session_purge_confirm:')) {
      const [, sessionId, page = '0'] = data.split(':'); const session = SessionManager.getSession(sessionId);
      if (!session || session.user_id !== userId || session.status !== 'DELETED') { await bot.answerCallbackQuery(callbackQuery.id, { text: '삭제할 세션을 찾을 수 없습니다.' }); return; }
      await editMessageIfChanged(bot, `${uiStatusIcon('warning')} **세션 영구 삭제**\n\n**${md(session.title, 50)}**\n\n대화 기록과 해당 세션의 첨부파일을 영구 삭제합니다. 이 작업은 복구할 수 없습니다.`, {
        chat_id: chatId, message_id: callbackQuery.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}영구 삭제`, callback_data: `session_purge:${session.id}:${page}` }],[{ text: '취소', callback_data: `session_info:${session.id}:DELETED:${page}` }]] }
      });
      await bot.answerCallbackQuery(callbackQuery.id); return;
    }
    if (data.startsWith('session_purge:')) { const [, sessionId, page = '0'] = data.split(':'); SessionManager.permanentlyDeleteSession(userId, sessionId); await bot.answerCallbackQuery(callbackQuery.id, { text: '세션을 영구 삭제했습니다.' }); await renderSessions(bot, callbackQuery, 'DELETED', Number(page) || 0); return; }
    if (data === 'session_trash_confirm') { await confirmTrashEmpty(bot, callbackQuery); return; }
    if (data === 'session_trash_empty') { const count = SessionManager.emptyTrash(userId); await bot.answerCallbackQuery(callbackQuery.id, { text: `휴지통의 세션 ${count}개를 영구 삭제했습니다.` }); await renderSessions(bot, callbackQuery, 'DELETED', 0); return; }
    if (data === 'session_create_new') { const newSession = SessionManager.createSession(userId); await bot.answerCallbackQuery(callbackQuery.id, { text: `새 세션 생성: ${newSession.title}` }); await renderSessions(bot, callbackQuery, 'ACTIVE', 0); }
  } catch (error) { console.error(`[Sessions Callback Error] ${error.message}`); try { await bot.answerCallbackQuery(callbackQuery.id, { text: `처리 실패: ${error.message}`, show_alert: true }); } catch {} }
}
