import { isStealthMode } from '../renderer/ui-theme.js';

const DEFAULT_SCAN_LIMIT = 500;
const DELETE_DELAY_MS = 35;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIgnorableDeleteError(error) {
  const message = String(error?.message || '');
  return /message to delete not found|message can't be deleted|message identifier is not specified|bad request/i.test(message);
}

export async function handleClearCommand(bot, msg) {
  const chatId = msg.chat.id;
  const newestMessageId = msg.message_id;
  const oldestMessageId = Math.max(1, newestMessageId - DEFAULT_SCAN_LIMIT + 1);
  let deleted = 0;
  let failed = 0;

  // Telegram 전용 정리 기능이다. Agent Hub DB/session/message records에는 손대지 않는다.
  // Bot API 삭제 제한(대표적으로 오래된 메시지 등)에 걸리는 항목은 건너뛴다.
  for (let messageId = newestMessageId; messageId >= oldestMessageId; messageId -= 1) {
    try {
      await bot.deleteMessage(chatId, messageId);
      deleted += 1;
    } catch (error) {
      if (!isIgnorableDeleteError(error)) {
        failed += 1;
        console.warn(`[Command /clear] message_id=${messageId} 삭제 실패: ${error.message}`);
      }
    }

    // Telegram API에 짧은 간격을 두어 대량 삭제 시 rate limit 가능성을 낮춘다.
    if ((newestMessageId - messageId + 1) % 20 === 0) await sleep(DELETE_DELAY_MS);
  }

  console.log(`[Command /clear] Telegram 메시지 정리 완료: deleted=${deleted}, failed=${failed}, scanned=${newestMessageId - oldestMessageId + 1}`);

  // /clear 명령 자체까지 삭제되므로 성공 메시지를 남기지 않는다.
  // 삭제할 수 없는 메시지가 있어도 Agent Hub 데이터에는 영향을 주지 않는다.
  if (failed > 0) {
    const text = isStealthMode()
      ? `! 일부 Telegram 메시지를 삭제하지 못했습니다. Agent Hub 세션/기록은 변경되지 않았습니다.`
      : `⚠️ 일부 Telegram 메시지를 삭제하지 못했습니다. Agent Hub 세션/기록은 변경되지 않았습니다.`;
    const notice = await bot.sendMessage(chatId, text).catch(() => null);
    if (notice?.message_id) {
      setTimeout(() => bot.deleteMessage(chatId, notice.message_id).catch(() => {}), 5000);
    }
  }
}
