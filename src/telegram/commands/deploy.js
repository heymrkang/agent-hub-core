import { DeployRepository } from '../../deploy/deploy-repository.js';
import { uiTitle, uiStatusIcon, isStealthMode } from '../renderer/ui-theme.js';

export function buildDeployListView() {
  const targets = DeployRepository.list();
  const stealth = isStealthMode();

  let text = stealth
    ? '■ **Coolify 배포 관리 (`/deploy`)**\n\n'
    : `${uiTitle('🚀', 'Coolify 배포 관리')}\n_원클릭으로 Coolify 배포 Webhook을 트리거합니다._\n\n`;

  if (!targets.length) {
    text += '_등록된 배포 대상이 없습니다._\n\n';
  } else {
    for (const target of targets) {
      text += `• 🚀 **${target.name}**\n`;
      if (target.description) {
        text += `  _${target.description}_\n`;
      }
      text += `  \`${target.webhookUrl.replace(/\/\/[^@]+@/, '//***@')}\`\n`;
    }
    text += '\n';
  }

  text += `💡 **명령어 사용법**:\n`;
  text += `• \`/deploy <이름>\` : 즉시 배포 트리거\n`;
  text += `• \`/deploy add <이름> <Webhook-URL> [설명]\` : 배포 대상 등록\n`;
  text += `• \`/deploy remove <이름>\` : 배포 대상 삭제\n`;

  const inlineKeyboard = [];

  // 2열 버튼 그리드
  if (targets.length > 0) {
    for (let i = 0; i < targets.length; i += 2) {
      const row = [
        { text: `🚀 ${targets[i].name}`, callback_data: `deploy_trigger:${targets[i].name}` }
      ];
      if (targets[i + 1]) {
        row.push({ text: `🚀 ${targets[i + 1].name}`, callback_data: `deploy_trigger:${targets[i + 1].name}` });
      }
      inlineKeyboard.push(row);
    }
  }

  inlineKeyboard.push([
    { text: '🔄 새로고침', callback_data: 'deploy_refresh' }
  ]);

  return { text, reply_markup: { inline_keyboard: inlineKeyboard } };
}

export async function handleDeployCommand(bot, msg, rawArgs = '') {
  const chatId = msg.chat.id;
  const args = rawArgs?.trim() || '';

  try {
    if (!args) {
      const view = buildDeployListView();
      await bot.sendMessage(chatId, view.text, {
        parse_mode: 'Markdown',
        reply_markup: view.reply_markup
      });
      return;
    }

    const parts = args.split(/\s+/);
    const sub = parts[0].toLowerCase();

    // 1. 배포 타겟 추가: /deploy add <name> <url> [description]
    if (sub === 'add') {
      if (parts.length < 3) {
        await bot.sendMessage(
          chatId,
          `${uiStatusIcon('error')} 사용법: \`/deploy add <이름> <Webhook-URL> [설명]\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      const name = parts[1];
      const webhookUrl = parts[2];
      const description = parts.slice(3).join(' ');

      const created = DeployRepository.create({ name, webhookUrl, description });
      await bot.sendMessage(
        chatId,
        `${uiStatusIcon('success')} **배포 타겟이 등록되었습니다!**\n\n• 이름: \`${created.name}\`\n• 설명: ${created.description || '(없음)'}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // 2. 배포 타겟 삭제: /deploy remove <name>
    if (sub === 'remove' || sub === 'rm') {
      if (parts.length < 2) {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} 사용법: \`/deploy remove <이름>\``, { parse_mode: 'Markdown' });
        return;
      }
      const name = parts[1];
      const deleted = DeployRepository.delete(name);
      if (deleted) {
        await bot.sendMessage(chatId, `${uiStatusIcon('success')} 배포 타겟 \`${name}\`이(가) 삭제되었습니다.`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, `${uiStatusIcon('error')} 등록되지 않은 배포 타겟입니다: \`${name}\``, { parse_mode: 'Markdown' });
      }
      return;
    }

    // 3. 배포 트리거: /deploy <name>
    const targetName = sub;
    const target = DeployRepository.findByName(targetName);
    if (!target) {
      await bot.sendMessage(
        chatId,
        `${uiStatusIcon('error')} 등록되지 않은 배포 타겟입니다: \`${targetName}\`\n\n목록을 확인하려면 \`/deploy\`를 입력하세요.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await bot.sendMessage(
      chatId,
      `⏳ **[${target.name}]** Coolify 배포 요청을 전송 중입니다...`,
      { parse_mode: 'Markdown' }
    );

    const result = await DeployRepository.trigger(target.name);
    await bot.sendMessage(
      chatId,
      `${uiStatusIcon('success')} **[${target.name}]** Coolify 배포 요청 전송 완료!\n\n• 상태: \`HTTP ${result.status}\`\n• 빌드가 백그라운드에서 시작됩니다.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error(`[Command /deploy Error] ${err.message}`);
    await bot.sendMessage(chatId, `${uiStatusIcon('error')} 배포 실패: ${err.message}`, { parse_mode: 'Markdown' });
  }
}

export async function handleDeployCallback(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || '';

  try {
    if (data === 'deploy_refresh') {
      const view = buildDeployListView();
      await bot
        .editMessageText(view.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: view.reply_markup
        })
        .catch((e) => {
          if (!/message is not modified/i.test(String(e?.message || ''))) throw e;
        });
      await bot.answerCallbackQuery(query.id, { text: '🔄 목록이 갱신되었습니다.' });
      return;
    }

    if (data.startsWith('deploy_trigger:')) {
      const name = data.slice('deploy_trigger:'.length);
      await bot.answerCallbackQuery(query.id, { text: `🚀 ${name} 배포 요청 전송 중...` });

      try {
        const result = await DeployRepository.trigger(name);
        await bot.sendMessage(
          chatId,
          `${uiStatusIcon('success')} **[${name}]** Coolify 배포 요청 전송 완료!\n\n• 상태: \`HTTP ${result.status}\`\n• 빌드가 백그라운드에서 시작됩니다.`,
          { parse_mode: 'Markdown' }
        );
      } catch (triggerErr) {
        await bot.sendMessage(
          chatId,
          `${uiStatusIcon('error')} **[${name}]** 배포 실패: ${triggerErr.message}`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }
  } catch (err) {
    console.error(`[Deploy Callback Error] ${err.message}`);
    await bot.answerCallbackQuery(query.id, { text: `오류: ${err.message}` });
  }
}
