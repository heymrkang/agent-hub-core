import { queueManager } from '../../jobs/queue-manager.js';

/**
 * /queue 명령어 처리: 전체 큐 상태 및 동시성 현황 조회
 */
export async function handleQueueCommand(bot, msg) {
  const chatId = msg.chat.id;

  try {
    const stats = queueManager.getQueueStats();

    let text = `📊 **작업 큐 및 동시성 현황**\n\n`;
    text += `• **현재 실행 중인 작업**: \`${stats.activeExecutionsCount}\`개\n`;
    text += `• **대기 중인 작업**: \`${stats.totalQueued}\`개\n\n`;

    text += `⚙️ **Provider 동시 실행 상태**:\n`;
    for (const [provider, limit] of Object.entries(stats.providerLimits)) {
      const running = stats.providerRunning[provider] || 0;
      text += `  - **${provider.toUpperCase()}**: \`${running} / ${limit}\` 슬롯 사용 중\n`;
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error(`[Command /queue Error] ${error.message}`);
    await bot.sendMessage(chatId, `❌ 큐 상태 조회 실패: ${error.message}`);
  }
}
