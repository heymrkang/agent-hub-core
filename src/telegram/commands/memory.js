import { MemoryManager } from '../../memory/memory-manager.js';
import { uiTitle, uiStatusIcon } from '../renderer/ui-theme.js';

/**
 * /memory 명령어 처리: 글로벌 메모리 조회, 추가, 초기화 UI
 */
export async function handleMemoryCommand(bot, msg, args = '') {
  const chatId = msg.chat.id;
  const trimmedArgs = args?.trim();

  try {
    if (!trimmedArgs) {
      const memoryContent = MemoryManager.getMemoryContent();
      let text = `${uiTitle('🧠', '글로벌 장기 기억 (Global Memory)')}\n\n`;
      text += `\`\`\`markdown\n${memoryContent}\n\`\`\`\n`;
      text += `${uiTitle('📌', '사용법', '▪')}:\n`;
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
      MemoryManager.appendEntry(entry);
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} **메모리 추가 완료**\n\n- ${entry}`, { parse_mode: 'Markdown' });
      return;
    }

    if (trimmedArgs.startsWith('set ')) {
      const newContent = trimmedArgs.replace(/^set\s+/, '').trim();
      MemoryManager.writeMemoryFile(newContent, 'UPDATE', 'USER');
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} **메모리 전체 수정 완료**`, { parse_mode: 'Markdown' });
      return;
    }

    if (trimmedArgs === 'clear') {
      MemoryManager.clearMemory();
      await bot.sendMessage(chatId, `${uiStatusIcon('success')} 글로벌 메모리가 초기화되었습니다.`);
      return;
    }

    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 알 수 없는 메모리 옵션입니다.\n사용법: \`/memory\`, \`/memory add <내용>\`, \`/memory clear\``, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /memory Error] ${error.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 메모리 처리 실패: ${error.message}`);
  }
}
