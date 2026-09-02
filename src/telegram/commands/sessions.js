import { SessionManager } from '../../sessions/session-manager.js';
import { ProviderSessionRepository } from '../../sessions/provider-session-repository.js';
import { formatKST } from '../../utils/date.js';
import { isStealthMode, uiStatusIcon, uiTitle } from '../renderer/ui-theme.js';

const PAGE_SIZE = 5;
const VALID_STATUSES = new Set(['ACTIVE', 'ARCHIVED', 'DELETED']);

function normalizeStatus(value) { return VALID_STATUSES.has(value) ? value : 'ACTIVE'; }
function shortTitle(title, max = 30) { const value = String(title || '새 채팅').replace(/\s+/g, ' ').trim(); return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function escapeMarkdown(value) { return String(value ?? '').replace(/([_*`\[])/g, '\\$1'); }
function md(value, max = null) { const text = max ? shortTitle(value, max) : String(value ?? ''); return escapeMarkdown(text); }
function tabLabel(status, current) { const labels = { ACTIVE: '세션', ARCHIVED: '보관함', DELETED: '휴지통' }; return status === current ? `✓ ${labels[status]}` : labels[status]; }
function nav(label, icon) { return `${isStealthMode() ? '' : `${icon} `}${label}`; }
function isMessageNotModified(error) { return /message is not modified/i.test(String(error?.message || '')); }
function shortRef(value) { const ref = String(value || '').trim(); if (!ref) return '-'; return ref.length <= 16 ? ref : `${ref.slice(0, 8)}…${ref.slice(-4)}`; }
async function editMessageIfChanged(bot, text, options) { try { return await bot.editMessageText(text, options); } catch (error) { if (isMessageNotModified(error)) return null; throw error; } }

function mappingRows(sessionId) {
  return ProviderSessionRepository.list(sessionId);
}

function mappingSummary(sessionId) {
  const rows = mappingRows(sessionId);
  if (!rows.length) return 'native mapping 없음';
  return rows.map((row) => `${row.provider}:${row.state}:${shortRef(row.native_session_ref)}`).join(',');
}

function logLogicalSelection(userId, session, reason = 'switch') {
  if (!session) return;
  console.log(`[Sessions] logical ${reason}: user=${userId} session=${session.id} title=${JSON.stringify(session.title)} active_provider=${session.active_provider} mappings=${mappingSummary(session.id)}`);
}

async function renderSessions(bot, source, status = 'ACTIVE', page = 0) {
  status = normalizeStatus(status);
  const chatId = source.chat ? source.chat.id : source.message.chat.id;
  const userId = source.from.id;
  const activeSession = SessionManager.getActiveSession(userId);
  const sessions = SessionManager.listSessions(userId, status);
  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
  const pageItems = sessions.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const statusNames = { ACTIVE: '세션', ARCHIVED: '보관함', DELETED: '휴지통' };

  let text = `${uiTitle('📁', `Agent Hub · ${statusNames[status]}`)}\n\n`;
  text += `현재 Logical Session: **${md(activeSession.title, 36)}**\n`;
  text += `현재 Provider: ${md(activeSession.active_provider)}${activeSession.active_model ? ` · ${md(activeSession.active_model)}` : ''}\n\n`;

  if (!pageItems.length) {
    text += `_${statusNames[status]}에 세션이 없습니다._`;
  } else {
    text += `Logical Session ${sessions.length}개 · ${safePage + 1}/${totalPages} 페이지\n`;
    if (status === 'ACTIVE') text += `_세션을 먼저 선택하고, /model로 Provider를 바꾸면 같은 Logical Session 안의 Provider native conversation을 이어갑니다._`;
    else text += `_Agent Hub transcript 보관/복구 영역입니다. Provider native history는 자동 삭제하지 않습니다._`;
  }

  const keyboard = pageItems.map((session, index) => {
    const absoluteIndex = safePage * PAGE_SIZE + index + 1;
    const current = status === 'ACTIVE' && session.id === activeSession.id;
    const prefix = current ? '● ' : '';
    const lock = session.title_locked ? (isStealthMode() ? ' [LOCK]' : ' 🔒') : '';
    const provider = String(session.active_provider || 'codex').toUpperCase();
    return [{
      text: `${prefix}${absoluteIndex}. ${shortTitle(session.title)} · ${provider}${lock}`,
      callback_data: `session_info:${session.id}:${status}:${safePage}`
    }];
  });

  if (totalPages > 1) {
    const navRow = [];
    if (safePage > 0) navRow.push({ text: nav('이전', '◀'), callback_data: `session_page:${status}:${safePage - 1}` });
    navRow.push({ text: `${safePage + 1} / ${totalPages}`, callback_data: 'session_noop' });
    if (safePage < totalPages - 1) navRow.push({ text: nav('다음', '▶'), callback_data: `session_page:${status}:${safePage + 1}` });
    keyboard.push(navRow);
  }

  keyboard.push([
    { text: tabLabel('ACTIVE', status), callback_data: 'session_page:ACTIVE:0' },
    { text: tabLabel('ARCHIVED', status), callback_data: 'session_page:ARCHIVED:0' },
    { text: tabLabel('DELETED', status), callback_data: 'session_page:DELETED:0' }
  ]);

  if (status === 'ACTIVE') {
    keyboard.push([{ text: `${isStealthMode() ? '+ ' : '＋ '}새 세션 시작 (/new)`, callback_data: 'session_create_new' }]);
  }
  if (status === 'DELETED' && sessions.length > 0) {
    keyboard.push([{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}휴지통 비우기 (${sessions.length})`, callback_data: 'session_trash_confirm' }]);
  }

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
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;
  const session = SessionManager.getSession(sessionId);
  if (!session || String(session.user_id) !== String(userId) || session.is_system) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션을 찾을 수 없습니다.' });
    return;
  }

  const activeSession = SessionManager.getActiveSession(userId);
  const isCurrent = session.id === activeSession.id;
  const status = normalizeStatus(returnStatus || session.status);
  const page = Math.max(Number(returnPage) || 0, 0);
  const statusNames = { ACTIVE: '활성', ARCHIVED: '보관함', DELETED: '휴지통' };
  const mappings = mappingRows(session.id);

  let text = `${uiTitle('📄', md(session.title, 50))}\n\n`;
  text += `상태: ${statusNames[session.status] || md(session.status)}${isCurrent ? ' · 현재 세션' : ''}\n`;
  text += `Active Provider: ${md(session.active_provider)}${session.active_model ? ` · ${md(session.active_model)}` : ''}\n`;
  text += `Thinking: ${md(session.reasoning_effort || 'default')}\n`;
  text += `Profile: ${md(session.execution_profile)}\n`;
  text += `최근 활동: ${md(formatKST(session.updated_at))}\n`;
  if (session.title_locked) text += `제목: 사용자 지정${isStealthMode() ? ' [LOCK]' : ' 🔒'}\n`;

  text += `\n**Provider Native Mapping**\n`;
  if (!mappings.length) text += `_아직 연결된 Provider native conversation이 없습니다._\n`;
  else {
    for (const mapping of mappings) {
      text += `• ${md(mapping.provider.toUpperCase())}: \`${md(mapping.state)}\` · \`${md(shortRef(mapping.native_session_ref))}\`\n`;
    }
  }

  const buttons = [];
  if (session.status === 'ACTIVE') {
    if (!isCurrent) buttons.push([{ text: '✓ 이 Logical Session으로 전환', callback_data: `session_switch:${session.id}:${page}` }]);
    buttons.push([
      { text: nav('보관', '📦'), callback_data: `session_archive:${session.id}:${page}` },
      { text: nav('휴지통으로', '🗑'), callback_data: `session_delete:${session.id}:${page}` }
    ]);
  } else if (session.status === 'ARCHIVED') {
    buttons.push([{ text: nav('복구', '♻'), callback_data: `session_restore:${session.id}:ARCHIVED:${page}` }]);
  } else if (session.status === 'DELETED') {
    buttons.push([{ text: nav('복구', '♻'), callback_data: `session_restore:${session.id}:DELETED:${page}` }]);
    buttons.push([{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}영구 삭제`, callback_data: `session_purge_confirm:${session.id}:${page}` }]);
  }
  buttons.push([{ text: '← 목록', callback_data: `session_page:${status}:${page}` }]);

  await editMessageIfChanged(bot, text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
  await bot.answerCallbackQuery(callbackQuery.id);
}

async function confirmTrashEmpty(bot, callbackQuery) {
  const userId = callbackQuery.from.id;
  const count = SessionManager.countSessions(userId, 'DELETED');
  if (!count) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '휴지통이 비어 있습니다.' });
    await renderSessions(bot, callbackQuery, 'DELETED', 0);
    return;
  }
  await editMessageIfChanged(bot, `${uiStatusIcon('warning')} **휴지통 비우기**\n\n휴지통의 세션 **${count}개**를 영구 삭제합니다.\n대화 기록과 해당 세션의 첨부파일도 함께 제거되며 복구할 수 없습니다.\nProvider native history는 자동 삭제하지 않습니다.`, {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [
      [{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}${count}개 영구 삭제`, callback_data: 'session_trash_empty' }],
      [{ text: '취소', callback_data: 'session_page:DELETED:0' }]
    ] }
  });
  await bot.answerCallbackQuery(callbackQuery.id);
}

async function handleLegacyNativeCallback(bot, callbackQuery, data) {
  if (data.startsWith('native_map:')) {
    const [, sessionId] = data.split(':');
    const session = SessionManager.getSession(sessionId);
    if (session && String(session.user_id) === String(callbackQuery.from.id) && !session.is_system) {
      if (session.status !== 'ACTIVE') SessionManager.restoreSession(session.id);
      SessionManager.setActiveSession(callbackQuery.from.id, session.id);
      logLogicalSelection(callbackQuery.from.id, SessionManager.getSession(session.id), 'legacy-native-map');
    }
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션 화면이 Logical Session 기준으로 변경되었습니다.' }).catch(() => {});
    await renderSessions(bot, callbackQuery, 'ACTIVE', 0);
    return true;
  }

  if (data.startsWith('native_page:')) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '세션 화면이 Logical Session 기준으로 변경되었습니다.' }).catch(() => {});
    await renderSessions(bot, callbackQuery, 'ACTIVE', 0);
    return true;
  }

  if (data.startsWith('native_pick:')) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Provider native session 직접 선택은 비활성화되었습니다. /sessions에서 Agent Hub 세션을 선택하세요.',
      show_alert: true
    }).catch(() => {});
    return true;
  }

  return false;
}

export async function handleSessionsCallback(bot, callbackQuery) {
  const data = callbackQuery.data || '';
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;

  try {
    if (await handleLegacyNativeCallback(bot, callbackQuery, data)) return;
    if (data === 'session_noop') { await bot.answerCallbackQuery(callbackQuery.id); return; }

    if (data.startsWith('session_tab:')) {
      const status = normalizeStatus(data.replace('session_tab:', ''));
      await renderSessions(bot, callbackQuery, status, 0);
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    if (data.startsWith('session_page:')) {
      const [, status, page] = data.split(':');
      await renderSessions(bot, callbackQuery, normalizeStatus(status), Number(page) || 0);
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    if (data.startsWith('session_info:')) {
      const [, sessionId, status = 'ACTIVE', page = '0'] = data.split(':');
      await showSessionDetail(bot, callbackQuery, sessionId, status, page);
      return;
    }

    if (data.startsWith('session_switch:')) {
      const [, sessionId, page = '0'] = data.split(':');
      const session = SessionManager.getSession(sessionId);
      if (!session || String(session.user_id) !== String(userId) || session.is_system || session.status !== 'ACTIVE') throw new Error('전환할 Logical Session을 찾을 수 없습니다.');
      SessionManager.setActiveSession(userId, sessionId);
      const selected = SessionManager.getSession(sessionId);
      logLogicalSelection(userId, selected, 'switch');
      await bot.answerCallbackQuery(callbackQuery.id, { text: `[${selected.title}] (으)로 전환되었습니다.` });
      await renderSessions(bot, callbackQuery, 'ACTIVE', Number(page) || 0);
      return;
    }

    if (data.startsWith('session_archive:')) {
      const [, sessionId, page = '0'] = data.split(':');
      SessionManager.archiveSession(sessionId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '세션이 보관되었습니다.' });
      await renderSessions(bot, callbackQuery, 'ACTIVE', Number(page) || 0);
      return;
    }

    if (data.startsWith('session_delete:')) {
      const [, sessionId, page = '0'] = data.split(':');
      SessionManager.softDeleteSession(sessionId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '휴지통으로 이동했습니다. 30일간 복구할 수 있습니다.' });
      await renderSessions(bot, callbackQuery, 'ACTIVE', Number(page) || 0);
      return;
    }

    if (data.startsWith('session_restore:')) {
      const [, sessionId, fromStatus = 'DELETED', page = '0'] = data.split(':');
      SessionManager.restoreSession(sessionId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: '세션을 복구했습니다.' });
      await renderSessions(bot, callbackQuery, normalizeStatus(fromStatus), Number(page) || 0);
      return;
    }

    if (data.startsWith('session_purge_confirm:')) {
      const [, sessionId, page = '0'] = data.split(':');
      const session = SessionManager.getSession(sessionId);
      if (!session || String(session.user_id) !== String(userId) || session.status !== 'DELETED') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '삭제할 세션을 찾을 수 없습니다.' });
        return;
      }
      await editMessageIfChanged(bot, `${uiStatusIcon('warning')} **세션 영구 삭제**\n\n**${md(session.title, 50)}**\n\n대화 기록과 해당 세션의 첨부파일을 영구 삭제합니다. 이 작업은 복구할 수 없습니다.\nProvider native history는 자동 삭제하지 않습니다.`, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: `${isStealthMode() ? '[DEL] ' : '🗑 '}영구 삭제`, callback_data: `session_purge:${session.id}:${page}` }],
          [{ text: '취소', callback_data: `session_info:${session.id}:DELETED:${page}` }]
        ] }
      });
      await bot.answerCallbackQuery(callbackQuery.id);
      return;
    }

    if (data.startsWith('session_purge:')) {
      const [, sessionId, page = '0'] = data.split(':');
      SessionManager.permanentlyDeleteSession(userId, sessionId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Logical Session을 영구 삭제했습니다.' });
      await renderSessions(bot, callbackQuery, 'DELETED', Number(page) || 0);
      return;
    }

    if (data === 'session_trash_confirm') { await confirmTrashEmpty(bot, callbackQuery); return; }
    if (data === 'session_trash_empty') {
      const count = SessionManager.emptyTrash(userId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: `휴지통의 Logical Session ${count}개를 영구 삭제했습니다.` });
      await renderSessions(bot, callbackQuery, 'DELETED', 0);
      return;
    }

    if (data === 'session_create_new') {
      const current = SessionManager.getActiveSession(userId);
      const newSession = SessionManager.createSession(userId, {
        provider: current.active_provider,
        model: current.active_model,
        reasoningEffort: current.reasoning_effort,
        profile: current.execution_profile
      });
      logLogicalSelection(userId, newSession, 'create');
      await bot.answerCallbackQuery(callbackQuery.id, { text: `새 세션 생성: ${newSession.title}` });
      await renderSessions(bot, callbackQuery, 'ACTIVE', 0);
    }
  } catch (error) {
    console.error(`[Sessions Callback Error] ${error.message}`);
    try { await bot.answerCallbackQuery(callbackQuery.id, { text: `처리 실패: ${error.message}`, show_alert: true }); } catch {}
  }
}
