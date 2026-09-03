import { skillRepository } from '../../extensions/skill-repository.js';
import { skillSyncService } from '../../extensions/skill-sync-service.js';
import { uiTitle, uiStatusIcon, isStealthMode } from '../renderer/ui-theme.js';

export function buildSkillsListView() {
  const skills = skillRepository.list();
  const stealth = isStealthMode();

  let text = stealth
    ? '■ **Agent Skills 관리**\n_모든 Provider(Codex, Antigravity)에 전역 동기화됩니다._\n\n'
    : `${uiTitle('🎯', 'Agent Skills 관리')}\n_모든 Provider(Codex, Antigravity)에 전역 동기화됩니다._\n\n`;

  if (!skills.length) {
    text += '_등록된 커스텀 스킬이 없습니다._\n\n';
  } else {
    for (const skill of skills) {
      const statusIcon = skill.valid ? '●' : '⚠️';
      text += `• ${statusIcon} **${skill.name}** (${skill.filesCount}개 파일)\n`;
      if (skill.description) {
        text += `  _${skill.description}_\n`;
      }
    }
    text += '\n';
  }

  text += `📁 **마스터 스킬 경로**:\n\`/data/skills/<스킬명>/SKILL.md\`\n\n`;
  text += `_새 스킬을 마스터 디렉토리에 생성하면 양쪽 Provider로 자동 미러링됩니다._`;

  const inlineKeyboard = [
    [
      { text: '🔄 Provider 전체 재동기화', callback_data: 'skills_sync' }
    ]
  ];

  return { text, reply_markup: { inline_keyboard: inlineKeyboard } };
}

export async function handleSkillsCommand(bot, msg, rawArgs = '') {
  const chatId = msg.chat.id;
  const args = rawArgs?.trim() || '';

  try {
    if (!args) {
      const view = buildSkillsListView();
      await bot.sendMessage(chatId, view.text, {
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }

    if (args === 'sync') {
      const res = skillSyncService.syncAll();
      await bot.sendMessage(
        chatId,
        `${uiStatusIcon('success')} **Skills Provider 전체 동기화 완료**\n\n• 총 스킬: \`${res.skillsCount}개\`\n• Codex: \`${res.codex.targetDir}\`\n• Antigravity: \`${res.gemini.targetDir}\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 지원하지 않는 서브커맨드입니다.\n\n사용법:\n• \`/skills\` : 스킬 목록 조회\n• \`/skills sync\` : 수동 재동기화`, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`[Command /skills Error] ${err.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} Skills 처리 실패: ${err.message}`, { parse_mode: 'Markdown' });
  }
}

export async function handleSkillsCallback(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || '';

  try {
    if (data === 'skills_sync') {
      const res = skillSyncService.syncAll();
      await bot.answerCallbackQuery(query.id, { text: `✅ Skills 동기화 완료 (${res.skillsCount}개 스킬)` });
      const view = buildSkillsListView();
      await bot.editMessageText(view.text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }
  } catch (err) {
    console.error(`[Skills Callback Error] ${err.message}`);
    await bot.answerCallbackQuery(query.id, { text: `오류: ${err.message}` });
  }
}
