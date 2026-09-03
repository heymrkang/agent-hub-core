import { McpRepository } from '../../extensions/mcp-repository.js';
import { mcpSyncService } from '../../extensions/mcp-sync-service.js';
import { uiTitle, uiStatusIcon, isStealthMode } from '../renderer/ui-theme.js';

export const MCP_PRESETS = {
  github: {
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    description: 'GitHub API 레포지토리 및 이슈 연동'
  },
  fetch: {
    name: 'fetch',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    envKeys: [],
    description: '웹페이지 내용 및 외부 API 데이터 Fetch'
  },
  memory: {
    name: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envKeys: [],
    description: '시맨틱 지식 그래프 기반 장기 메모리'
  },
  sqlite: {
    name: 'sqlite',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/data/mcp.db'],
    envKeys: [],
    description: '로컬 SQLite 데이터베이스 쿼리 연동'
  }
};

export function buildMcpListView() {
  const servers = McpRepository.list();
  const stealth = isStealthMode();

  let text = stealth
    ? '■ **MCP 서버 관리 (Model Context Protocol)**\n_모든 Provider(Codex, Antigravity)에 전역 동기화됩니다._\n\n'
    : `${uiTitle('🧩', 'MCP 서버 관리 (Model Context Protocol)')}\n_모든 Provider(Codex, Antigravity)에 전역 동기화됩니다._\n\n`;

  if (!servers.length) {
    text += '_등록된 MCP 서버가 없습니다. 아래 프리셋이나 명령어로 추가하세요._\n\n';
  } else {
    for (const server of servers) {
      const icon = server.enabled ? '●' : '○';
      const statusText = server.enabled ? '활성' : '비활성';
      text += `• ${icon} **${server.name}** (\`${server.transport}\`) · \`${statusText}\`\n`;
      if (server.description) {
        text += `  _${server.description}_\n`;
      }
    }
    text += '\n';
  }

  text += `**사용법**:\n`;
  text += `• \`/mcp add <이름> <명령어/URL> [--env KEY1,KEY2]\`\n`;
  text += `• \`/mcp toggle <이름>\` : On/Off 토글\n`;
  text += `• \`/mcp remove <이름>\` : 삭제\n`;
  text += `• \`/mcp sync\` : 수동 전체 재동기화`;

  const inlineKeyboard = [];

  // Server detail buttons
  if (servers.length) {
    const serverButtons = servers.map((s) => ({
      text: `${s.enabled ? '●' : '○'} ${s.name}`,
      callback_data: `mcp_view:${s.id}`
    }));
    for (let i = 0; i < serverButtons.length; i += 2) {
      inlineKeyboard.push(serverButtons.slice(i, i + 2));
    }
  }

  // Preset buttons
  inlineKeyboard.push([
    { text: '+ GitHub', callback_data: 'mcp_preset:github' },
    { text: '+ Fetch', callback_data: 'mcp_preset:fetch' },
    { text: '+ Memory', callback_data: 'mcp_preset:memory' },
    { text: '+ SQLite', callback_data: 'mcp_preset:sqlite' }
  ]);

  // Sync button
  inlineKeyboard.push([
    { text: '🔄 Provider 전체 동기화', callback_data: 'mcp_sync' }
  ]);

  return { text, reply_markup: { inline_keyboard: inlineKeyboard } };
}

export function buildMcpDetailView(serverId) {
  const server = McpRepository.getById(serverId);
  if (!server) return null;

  const statusText = server.enabled ? '🟢 활성 (Enabled)' : '🔴 비활성 (Disabled)';
  let text = `${uiTitle('🧩', `MCP 상세 · ${server.name}`)}\n\n`;
  text += `• **상태**: ${statusText}\n`;
  text += `• **Transport**: \`${server.transport}\`\n`;
  if (server.transport === 'stdio') {
    text += `• **명령어**: \`${server.command} ${server.args.join(' ')}\`\n`;
    if (server.envKeys?.length) {
      text += `• **매핑 환경변수**: \`${server.envKeys.join(', ')}\`\n`;
    }
  } else {
    text += `• **URL**: \`${server.url}\`\n`;
  }
  if (server.description) {
    text += `• **설명**: ${server.description}\n`;
  }

  const toggleBtnText = server.enabled ? '🔴 비활성화' : '🟢 활성화';
  const inlineKeyboard = [
    [
      { text: toggleBtnText, callback_data: `mcp_toggle:${server.id}` },
      { text: '🗑 삭제', callback_data: `mcp_delete:${server.id}` }
    ],
    [
      { text: '‹ 목록으로', callback_data: 'mcp_list' }
    ]
  ];

  return { text, reply_markup: { inline_keyboard: inlineKeyboard } };
}

export async function handleMcpCommand(bot, msg, rawArgs = '') {
  const chatId = msg.chat.id;
  const args = rawArgs?.trim() || '';

  try {
    if (!args) {
      const view = buildMcpListView();
      await bot.sendMessage(chatId, view.text, {
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }

    if (args === 'sync') {
      const res = mcpSyncService.syncAll();
      await bot.sendMessage(
        chatId,
        `${uiStatusIcon('success')} **MCP Provider 전체 동기화 완료**\n\n• 총 서버: \`${res.serversCount}개\`\n• Codex: \`${res.codex.path}\`\n• Antigravity: \`${res.gemini.path}\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (args.startsWith('toggle ')) {
      const name = args.replace(/^toggle\s+/, '').trim().toLowerCase();
      const server = McpRepository.getByName(name);
      if (!server) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} MCP 서버를 찾을 수 없습니다: \`${name}\``, { parse_mode: 'Markdown' });
        return;
      }
      const toggled = McpRepository.toggle(server.id);
      mcpSyncService.syncAll();
      const statusText = toggled.enabled ? '활성화' : '비활성화';
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} MCP 서버 **${toggled.name}**이(가) **${statusText}**되었습니다. (양쪽 Provider 동기화 완료)`, { parse_mode: 'Markdown' });
      return;
    }

    if (args.startsWith('remove ') || args.startsWith('rm ') || args.startsWith('delete ')) {
      const name = args.replace(/^(?:remove|rm|delete)\s+/, '').trim().toLowerCase();
      const server = McpRepository.getByName(name);
      if (!server) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} MCP 서버를 찾을 수 없습니다: \`${name}\``, { parse_mode: 'Markdown' });
        return;
      }
      McpRepository.delete(server.id);
      mcpSyncService.syncAll();
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} MCP 서버 **${name}**이(가) 삭제되었습니다. (양쪽 Provider 동기화 완료)`, { parse_mode: 'Markdown' });
      return;
    }

    if (args.startsWith('add ')) {
      const payload = args.replace(/^add\s+/, '').trim();
      // Format: <name> <commandOrUrl> [--env KEY1,KEY2] [--desc description]
      const parts = payload.split(/\s+/);
      const name = parts[0]?.toLowerCase();
      if (!name) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} 서버 이름을 입력하세요.\n예: \`/mcp add fs npx -y @modelcontextprotocol/server-filesystem /home/dev\``, { parse_mode: 'Markdown' });
        return;
      }

      const rest = payload.slice(name.length).trim();
      let envKeys = [];
      let commandOrUrl = rest;

      const envMatch = commandOrUrl.match(/--env\s+([A-Za-z0-9_,-]+)/);
      if (envMatch) {
        envKeys = envMatch[1].split(',').map((k) => k.trim()).filter(Boolean);
        commandOrUrl = commandOrUrl.replace(/--env\s+[A-Za-z0-9_,-]+/, '').trim();
      }

      if (!commandOrUrl) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} 실행 명령어나 URL을 입력하세요.`, { parse_mode: 'Markdown' });
        return;
      }

      const isHttp = /^https?:\/\//i.test(commandOrUrl);
      let created;
      if (isHttp) {
        created = McpRepository.create({
          name,
          transport: 'http',
          url: commandOrUrl,
          envKeys
        });
      } else {
        const tokens = commandOrUrl.split(/\s+/);
        created = McpRepository.create({
          name,
          transport: 'stdio',
          command: tokens[0],
          args: tokens.slice(1),
          envKeys
        });
      }

      mcpSyncService.syncAll();
      await bot.sendMessage(
        chatId,
        `${uiStatusIcon('success')} **MCP 서버 '${created.name}' 등록 및 동기화 완료**\n\n• Type: \`${created.transport}\`\n• Target: \`${created.command || created.url}\`${envKeys.length ? `\n• Env: \`${envKeys.join(', ')}\`` : ''}\n\nCodex와 Antigravity 양쪽에 즉시 적용되었습니다.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 지원하지 않는 서브커맨드입니다.\n\n사용법:\n• \`/mcp\` : 목록 조회\n• \`/mcp add <이름> <명령어/URL> [--env KEY]\`\n• \`/mcp toggle <이름>\`\n• \`/mcp remove <이름>\`\n• \`/mcp sync\``, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`[Command /mcp Error] ${err.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} MCP 처리 실패: ${err.message}`, { parse_mode: 'Markdown' });
  }
}

export async function handleMcpCallback(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || '';

  try {
    if (data === 'mcp_list') {
      const view = buildMcpListView();
      await bot.editMessageText(view.text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'mcp_sync') {
      const res = mcpSyncService.syncAll();
      await bot.answerCallbackQuery(query.id, { text: `✅ Provider 동기화 완료 (${res.serversCount}개 서버)` });
      const view = buildMcpListView();
      await bot.editMessageText(view.text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }

    if (data.startsWith('mcp_preset:')) {
      const presetKey = data.replace('mcp_preset:', '');
      const preset = MCP_PRESETS[presetKey];
      if (!preset) {
        await bot.answerCallbackQuery(query.id, { text: '알 수 없는 프리셋입니다.' });
        return;
      }

      const existing = McpRepository.getByName(preset.name);
      if (existing) {
        await bot.answerCallbackQuery(query.id, { text: `'${preset.name}' 서버가 이미 존재합니다.` });
        return;
      }

      McpRepository.create(preset);
      mcpSyncService.syncAll();
      await bot.answerCallbackQuery(query.id, { text: `✅ '${preset.name}' 프리셋이 추가되었습니다!` });

      const view = buildMcpListView();
      await bot.editMessageText(view.text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }

    if (data.startsWith('mcp_view:')) {
      const id = data.replace('mcp_view:', '');
      const detail = buildMcpDetailView(id);
      if (!detail) {
        await bot.answerCallbackQuery(query.id, { text: '서버를 찾을 수 없습니다.' });
        return;
      }
      await bot.editMessageText(detail.text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: detail.reply_markup
      });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('mcp_toggle:')) {
      const id = data.replace('mcp_toggle:', '');
      const updated = McpRepository.toggle(id);
      mcpSyncService.syncAll();
      await bot.answerCallbackQuery(query.id, {
        text: updated.enabled ? '🟢 활성화되었습니다.' : '🔴 비활성화되었습니다.'
      });
      const detail = buildMcpDetailView(id);
      if (detail) {
        await bot.editMessageText(detail.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: detail.reply_markup
        });
      }
      return;
    }

    if (data.startsWith('mcp_delete:')) {
      const id = data.replace('mcp_delete:', '');
      const server = McpRepository.getById(id);
      const name = server?.name || id;
      McpRepository.delete(id);
      mcpSyncService.syncAll();
      await bot.answerCallbackQuery(query.id, { text: `🗑 '${name}' 서버가 삭제되었습니다.` });

      const view = buildMcpListView();
      await bot.editMessageText(view.text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }
  } catch (err) {
    console.error(`[Mcp Callback Error] ${err.message}`);
    await bot.answerCallbackQuery(query.id, { text: `오류: ${err.message}` });
  }
}
