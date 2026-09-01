import { isStealthMode } from '../renderer/ui-theme.js';

const DEFAULT_SCAN_LIMIT = 500;
const DELETE_BATCH_SIZE = 100;
const DELETE_BATCH_DELAY_MS = 250;
const clearCooldownUntilByChat = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterSeconds(error) {
  const direct = Number(
    error?.retryAfter
    ?? error?.response?.body?.parameters?.retry_after
    ?? error?.response?.headers?.['retry-after']
    ?? error?.response?.headers?.['Retry-After']
  );
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct);

  const match = String(error?.message || '').match(/retry(?:_| )after[=\s]+(\d+)/i);
  if (match) return Number(match[1]);
  return null;
}

function isRateLimitError(error) {
  return error?.category === 'RATE_LIMIT'
    || error?.statusCode === 429
    || error?.response?.statusCode === 429
    || error?.response?.body?.error_code === 429
    || /429 Too Many Requests|rate-limit cooldown|retry_after=/i.test(String(error?.message || ''));
}

function getCooldownSeconds(chatId) {
  const until = clearCooldownUntilByChat.get(String(chatId)) || 0;
  const remainingMs = until - Date.now();
  if (remainingMs <= 0) {
    clearCooldownUntilByChat.delete(String(chatId));
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}

function setCooldown(chatId, retryAfterSeconds) {
  if (!retryAfterSeconds) return;
  clearCooldownUntilByChat.set(String(chatId), Date.now() + retryAfterSeconds * 1000);
}

function buildMessageIdBatches(newestMessageId) {
  const oldestMessageId = Math.max(1, newestMessageId - DEFAULT_SCAN_LIMIT + 1);
  const ids = [];
  for (let messageId = newestMessageId; messageId >= oldestMessageId; messageId -= 1) {
    ids.push(messageId);
  }

  const batches = [];
  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    batches.push(ids.slice(index, index + DELETE_BATCH_SIZE));
  }
  return batches;
}

export async function handleClearCommand(bot, msg) {
  const chatId = msg.chat.id;
  const cooldownSeconds = getCooldownSeconds(chatId);
  if (cooldownSeconds > 0) {
    console.warn(`[Command /clear] Telegram rate-limit cooldown 활성: retry_after=${cooldownSeconds}s`);
    return;
  }

  if (typeof bot.deleteMessages !== 'function') {
    throw new Error('현재 node-telegram-bot-api에서 deleteMessages를 사용할 수 없습니다.');
  }

  const batches = buildMessageIdBatches(msg.message_id);
  let attempted = 0;
  let successfulBatches = 0;
  let failedBatches = 0;
  let rateLimited = false;
  let retryAfterSeconds = null;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    attempted += batch.length;

    try {
      await bot.deleteMessages(chatId, batch);
      successfulBatches += 1;
    } catch (error) {
      if (isRateLimitError(error)) {
        rateLimited = true;
        retryAfterSeconds = getRetryAfterSeconds(error);
        setCooldown(chatId, retryAfterSeconds);
        console.warn(`[Command /clear] Telegram 429 감지: retry_after=${retryAfterSeconds ?? 'unknown'}s, 추가 삭제 요청 중단`);
        break;
      }

      failedBatches += 1;
      console.warn(`[Command /clear] batch=${index + 1}/${batches.length} 삭제 실패: ${error.message}`);
    }

    if (index < batches.length - 1) await sleep(DELETE_BATCH_DELAY_MS);
  }

  console.log(`[Command /clear] Telegram 메시지 정리 완료: scanned=${batches.flat().length}, attempted=${attempted}, successful_batches=${successfulBatches}, failed_batches=${failedBatches}, rate_limited=${rateLimited}`);

  if (failedBatches > 0 && !rateLimited) {
    const text = isStealthMode()
      ? `! 일부 Telegram 메시지 배치를 삭제하지 못했습니다. Agent Hub 세션/기록은 변경되지 않았습니다.`
      : `⚠️ 일부 Telegram 메시지 배치를 삭제하지 못했습니다. Agent Hub 세션/기록은 변경되지 않았습니다.`;
    const notice = await bot.sendMessage(chatId, text).catch(() => null);
    if (notice?.message_id) {
      setTimeout(() => bot.deleteMessage(chatId, notice.message_id).catch(() => {}), 5000);
    }
  }
}

export const __clearTestUtils = {
  buildMessageIdBatches,
  getRetryAfterSeconds,
  isRateLimitError,
  clearCooldownUntilByChat,
};
