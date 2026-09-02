import { MemoryManager } from '../../memory/memory-manager.js';
import { uiTitle, uiStatusIcon } from '../renderer/ui-theme.js';

function syncSummary(syncResult = []) {
  if (!syncResult.length) return '';
  return `\n\n${syncResult.map((item) => `• ${item.provider.toUpperCase()}: \`${item.path}\``).join('\n')}`;
}

/**
 * /memory command
 * - Agent Hub MEMORY.md is the canonical source of truth.
 * - Every mutation mirrors the managed block to Codex AGENTS.md and Antigravity GEMINI.md.
 */
export async function handleMemoryCommand(bot, msg, args = '') {
  const chatId = msg.chat.id;
  const trimmedArgs = args?.trim();

  try {
    if (!trimmedArgs) {
      const memoryContent = MemoryManager.getMemoryContent();
      const targets = MemoryManager.getProviderRulesTargets();
      let text = `${uiTitle('🧠', '글로벌 장기 기억 (Global Memory)')}\n\n`;
      text += `\`\`\`markdown\n${memoryContent}\n\`\`\`\n`;
      text += `${uiTitle('🔄', 'Provider Rules Mirror', '▪')}:\n`;
      text += targets.map((item) => `• ${item.provider.toUpperCase()}: \`${item.path}\``).join('\n');
      text += `\n\n${uiTitle('📌', '사용법', '▪')}:\n`;
      text += `• \`/memory <내용>\` : 새 메모리 항목 추가\n`;
      text += `• \`/memory add <내용>\` : 새 메모리 항목 추가\n`;
      text += `• \`/memory set <내용>\` : 메모리 전체 내용 수정\n`;
      text += `• \`/memory clear\` : 메모리 초기화`;
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return;
    }

    if (trimmedArgs.startsWith('add ')) {
      const entry = trimmedArgs.replace(/^add\s+/, '').trim();
      if (!entry) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} 추가할 메모리 내용을 입력해주세요.\n예: \`/memory add 프로젝트 빌드 명령어는 npm run build 이다.\``, { parse_mode: 'Markdown' });
        return;
      }
      const sync = MemoryManager.appendEntry(entry);
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} **메모리 추가 및 Provider Rules 동기화 완료**\n\n- ${entry}${syncSummary(sync)}`, { parse_mode: 'Markdown' });
      return;
    }

    if (trimmedArgs.startsWith('set ')) {
      const newContent = trimmedArgs.replace(/^set\s+/, '').trim();
      if (!newContent) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} 저장할 메모리 내용을 입력해주세요.`);
        return;
      }
      const sync = MemoryManager.writeMemoryFile(newContent, 'UPDATE', 'USER');
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} **메모리 전체 수정 및 Provider Rules 동기화 완료**${syncSummary(sync)}`, { parse_mode: 'Markdown' });
      return;
    }

    if (trimmedArgs === 'clear') {
      const sync = MemoryManager.clearMemory();
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} 글로벌 메모리를 초기화하고 Provider Rules에 동기화했습니다.${syncSummary(sync)}`, { parse_mode: 'Markdown' });
      return;
    }

    // V2 shorthand: `/memory <내용>` is equivalent to `/memory add <내용>`.
    const sync = MemoryManager.appendEntry(trimmedArgs);
    await bot.sendMessage(chatId, `${uiStatusIcon('success')} **메모리 추가 및 Provider Rules 동기화 완료**\n\n- ${trimmedArgs}${syncSummary(sync)}`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /memory Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 메모리 처리 실패: ${error.message}`);
  }
}
