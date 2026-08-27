import path from 'path';
import { SshManager } from '../../ssh/ssh-manager.js';
import { SSH_KEYS_DIR } from '../../ssh/config-generator.js';

function esc(value) {
  return String(value || '').replace(/([_*`\[])/g, '\\$1');
}

async function renderServers(bot, source) {
  const chatId = source.chat ? source.chat.id : source.message.chat.id;
  const userId = source.from.id;
  const hosts = SshManager.listHosts(userId);
  let text = `🖥 **SSH Servers**\n\n`;
  text += `Key 경로: \`${SSH_KEYS_DIR}\`\n`;
  text += `_Private Key는 위 persistent volume 경로에 직접 배치하세요._\n\n`;
  if (!hosts.length) {
    text += `등록된 서버가 없습니다.\n\n`;
    text += `추가: \`/servers add <alias> <host> <user> <keyfile> [port]\``;
  } else {
    text += hosts.map((h, i) => `${i + 1}. ${h.enabled ? '●' : '○'} **${esc(h.alias)}** — ${esc(h.username)}@${esc(h.host)}:${h.port}`).join('\n');
  }

  const keyboard = hosts.slice(0, 12).map((h) => ([
    { text: `${h.enabled ? '●' : '○'} ${h.alias}`, callback_data: `server_info:${h.alias}` }
  ]));
  keyboard.push([{ text: '↻ 새로고침', callback_data: 'server_list' }]);

  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  if (!source.chat && source.message?.message_id) {
    await bot.editMessageText(text, { chat_id: chatId, message_id: source.message.message_id, ...options }).catch((e) => {
      if (!/message is not modified/i.test(e.message)) throw e;
    });
  } else {
    await bot.sendMessage(chatId, text, options);
  }
}

async function showServer(bot, q, alias) {
  const host = SshManager.getHost(q.from.id, alias);
  if (!host) {
    await bot.answerCallbackQuery(q.id, { text: '서버를 찾을 수 없습니다.' });
    return;
  }
  const text = `🖥 **${esc(host.alias)}**\n\n상태: ${host.enabled ? '활성' : '비활성'}\n주소: \`${esc(host.username)}@${esc(host.host)}:${host.port}\`\nKey: \`${esc(path.basename(host.identity_file))}\``;
  const keyboard = [
    [{ text: '🔌 연결 테스트', callback_data: `server_test:${host.alias}` }],
    [{ text: host.enabled ? '⏸ 비활성화' : '▶ 활성화', callback_data: `server_toggle:${host.alias}` }],
    [{ text: '🗑 Registry 제거', callback_data: `server_remove_confirm:${host.alias}` }],
    [{ text: '← 서버 목록', callback_data: 'server_list' }]
  ];
  await bot.editMessageText(text, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
  await bot.answerCallbackQuery(q.id);
}

export async function handleServersCommand(bot, msg, args = '') {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  const action = (parts.shift() || '').toLowerCase();
  try {
    if (!action) return renderServers(bot, msg);
    if (action === 'add') {
      const [alias, host, username, keyfile, port = '22'] = parts;
      if (!alias || !host || !username || !keyfile) {
        await bot.sendMessage(chatId, '사용법: `/servers add <alias> <host> <user> <keyfile> [port]`', { parse_mode: 'Markdown' });
        return;
      }
      const created = SshManager.addHost(userId, { alias, host, username, identityFile: keyfile, port: Number(port) });
      await bot.sendMessage(chatId, `✅ SSH 서버 등록: **${esc(created.alias)}**`, { parse_mode: 'Markdown' });
      return renderServers(bot, msg);
    }
    if (action === 'test') {
      const alias = parts[0];
      if (!alias) return bot.sendMessage(chatId, '사용법: `/servers test <alias>`', { parse_mode: 'Markdown' });
      const result = await SshManager.testConnection(userId, alias);
      await bot.sendMessage(chatId, result.ok ? `✅ ${alias}: SSH 연결 성공` : `❌ ${alias}: SSH 연결 실패\n\n${result.message}`);
      return;
    }
    if (action === 'remove') {
      const alias = parts[0];
      if (!alias) return bot.sendMessage(chatId, '사용법: `/servers remove <alias>`', { parse_mode: 'Markdown' });
      SshManager.removeHost(userId, alias);
      await bot.sendMessage(chatId, `Registry에서 ${alias} 제거 완료. Private Key 파일은 유지됩니다.`);
      return;
    }
    await bot.sendMessage(chatId, '지원 명령: `/servers`, `/servers add`, `/servers test`, `/servers remove`', { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /servers Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 서버 관리 실패: ${error.message}`);
  }
}

export async function handleServersCallback(bot, q) {
  const data = q.data || '';
  try {
    if (data === 'server_list') {
      await renderServers(bot, q);
      await bot.answerCallbackQuery(q.id);
      return;
    }
    if (data.startsWith('server_info:')) return showServer(bot, q, data.slice('server_info:'.length));
    if (data.startsWith('server_test:')) {
      const alias = data.slice('server_test:'.length);
      await bot.answerCallbackQuery(q.id, { text: 'SSH 연결 테스트 중...' });
      const result = await SshManager.testConnection(q.from.id, alias);
      await bot.sendMessage(q.message.chat.id, result.ok ? `✅ ${alias}: SSH 연결 성공` : `❌ ${alias}: SSH 연결 실패\n\n${result.message}`);
      return;
    }
    if (data.startsWith('server_toggle:')) {
      const alias = data.slice('server_toggle:'.length);
      const host = SshManager.getHost(q.from.id, alias);
      if (!host) throw new Error('서버를 찾을 수 없습니다.');
      SshManager.setEnabled(q.from.id, alias, !host.enabled);
      await showServer(bot, q, alias);
      return;
    }
    if (data.startsWith('server_remove_confirm:')) {
      const alias = data.slice('server_remove_confirm:'.length);
      await bot.editMessageText(`⚠️ **${esc(alias)} Registry 제거**\n\nSSH 설정에서 제거합니다. Private Key 파일은 삭제하지 않습니다.`, {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '🗑 제거', callback_data: `server_remove:${alias}` }],
          [{ text: '취소', callback_data: `server_info:${alias}` }]
        ] }
      });
      await bot.answerCallbackQuery(q.id);
      return;
    }
    if (data.startsWith('server_remove:')) {
      const alias = data.slice('server_remove:'.length);
      SshManager.removeHost(q.from.id, alias);
      await bot.answerCallbackQuery(q.id, { text: 'Registry에서 제거했습니다.' });
      await renderServers(bot, q);
    }
  } catch (error) {
    console.error(`[Servers Callback Error] ${error.message}`);
    try { await bot.answerCallbackQuery(q.id, { text: `실패: ${error.message}`, show_alert: true }); } catch {}
  }
}
