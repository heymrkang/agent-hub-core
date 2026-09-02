import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverTelegramText } from '../../src/telegram.js';

test('deliverTelegramText는 긴 메시지를 여러 건으로 분할 전송한다', async () => {
  const sent = [];
  const bot = {
    sendMessage: async (chatId, text, options) => {
      sent.push({ chatId, text, options });
      return { message_id: sent.length };
    }
  };

  const longText = `${'a'.repeat(3995)}\n${'b'.repeat(30)}`;
  const result = await deliverTelegramText(bot, 123, longText, { parse_mode: 'Markdown' }, 'failure');

  assert.equal(result, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chatId, 123);
  assert.equal(sent[0].options.parse_mode, 'Markdown');
  assert.equal(sent[0].text.length <= 4000, true);
  assert.equal(sent[1].text.length <= 4000, true);
  assert.equal(`${sent[0].text}\n${sent[1].text}`, longText);
});

test('deliverTelegramText는 rate-limit 오류면 청크별 deferred 재전송을 등록한다', async () => {
  const deferred = [];
  const rateLimitError = new Error('cooldown');
  rateLimitError.name = 'TelegramDeliveryError';
  rateLimitError.category = 'RATE_LIMIT';

  const bot = {
    __telegramTransport: {
      isRateLimitedError: (error) => error === rateLimitError,
      defer: (key, operation) => {
        deferred.push({ key, operation });
        return true;
      }
    },
    sendMessage: async () => {
      throw rateLimitError;
    }
  };

  await assert.rejects(
    () => deliverTelegramText(bot, 1, 'x'.repeat(4050), {}, 'job-failure:77'),
    (error) => error === rateLimitError
  );

  assert.deepEqual(deferred.map(({ key }) => key), ['job-failure:77:0']);
});
