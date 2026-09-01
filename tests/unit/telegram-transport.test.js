import test from 'node:test';
import assert from 'node:assert/strict';
import { installTelegramTransport, TelegramDeliveryError } from '../../src/telegram/transport.js';

function makeBot(overrides = {}) {
  return {
    sendMessage: async () => ({ message_id: 1 }),
    editMessageText: async () => true,
    deleteMessage: async () => true,
    deleteMessages: async () => true,
    answerCallbackQuery: async () => true,
    ...overrides
  };
}

function telegramError(statusCode, description, retryAfter = null) {
  return {
    code: 'ETELEGRAM',
    message: `ETELEGRAM: ${statusCode} ${description}`,
    response: {
      statusCode,
      headers: retryAfter ? { 'retry-after': String(retryAfter) } : {},
      body: {
        error_code: statusCode,
        description,
        ...(retryAfter ? { parameters: { retry_after: retryAfter } } : {})
      }
    }
  };
}

test('429 발생 시 cooldown을 설정하고 cooldown 중에는 Telegram API를 다시 호출하지 않는다', async () => {
  let calls = 0;
  let now = 1_000;
  const bot = makeBot({
    sendMessage: async () => {
      calls += 1;
      throw telegramError(429, 'Too Many Requests: retry after 30', 30);
    }
  });
  installTelegramTransport(bot, { now: () => now, sleepFn: async () => {} });

  await assert.rejects(() => bot.sendMessage(1, 'a'), (error) => error instanceof TelegramDeliveryError && error.category === 'RATE_LIMIT');
  assert.equal(calls, 1);
  await assert.rejects(() => bot.sendMessage(1, 'b'), /cooldown/);
  assert.equal(calls, 1);
  now += 31_000;
  await assert.rejects(() => bot.sendMessage(1, 'c'), /Too Many Requests/);
  assert.equal(calls, 2);
});

test('Markdown parse 400에서만 plain text fallback을 1회 수행한다', async () => {
  const seen = [];
  const bot = makeBot({
    sendMessage: async (chatId, text, options) => {
      seen.push({ chatId, text, options });
      if (seen.length === 1) throw telegramError(400, "Bad Request: can't parse entities");
      return { message_id: 7 };
    }
  });
  installTelegramTransport(bot, { sleepFn: async () => {} });

  const result = await bot.sendMessage(1, '**hello**', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] } });
  assert.equal(result.message_id, 7);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].options.parse_mode, undefined);
  assert.deepEqual(seen[1].options.reply_markup, { inline_keyboard: [] });
  assert.equal(seen[1].text.includes('*'), false);
});

test('403과 429는 Markdown plain fallback을 수행하지 않는다', async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const bot = makeBot({
      sendMessage: async () => {
        calls += 1;
        throw telegramError(status, status === 429 ? 'Too Many Requests: retry after 10' : 'Forbidden', status === 429 ? 10 : null);
      }
    });
    installTelegramTransport(bot, { sleepFn: async () => {} });
    await assert.rejects(() => bot.sendMessage(1, '**x**', { parse_mode: 'Markdown' }));
    assert.equal(calls, 1);
  }
});

test('일시적 network 오류는 제한 횟수만 재시도한다', async () => {
  let calls = 0;
  const bot = makeBot({
    sendMessage: async () => {
      calls += 1;
      if (calls < 3) { const error = new Error('socket reset'); error.code = 'ECONNRESET'; throw error; }
      return { message_id: 3 };
    }
  });
  installTelegramTransport(bot, { sleepFn: async () => {}, retryDelaysMs: [1, 1] });
  const result = await bot.sendMessage(1, 'ok');
  assert.equal(result.message_id, 3);
  assert.equal(calls, 3);
});
