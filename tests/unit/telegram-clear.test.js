import test from 'node:test';
import assert from 'node:assert/strict';
import { handleClearCommand, __clearTestUtils } from '../../src/telegram/commands/clear.js';

const CHAT_ID = 12345;

test('buildMessageIdBatches groups the 500-message scan into batches of at most 100', () => {
  const batches = __clearTestUtils.buildMessageIdBatches(550);

  assert.equal(batches.length, 5);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 100, 100, 100]);
  assert.equal(batches[0][0], 550);
  assert.equal(batches[4][99], 51);
});

test('/clear uses deleteMessages instead of one deleteMessage call per message', async () => {
  __clearTestUtils.clearCooldownUntilByChat.clear();
  const calls = [];
  const bot = {
    deleteMessages: async (chatId, messageIds) => {
      calls.push({ chatId, messageIds });
      return true;
    },
    sendMessage: async () => {
      throw new Error('sendMessage should not be called on successful clear');
    },
  };

  await handleClearCommand(bot, { chat: { id: CHAT_ID }, message_id: 50 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, CHAT_ID);
  assert.equal(calls[0].messageIds.length, 50);
  assert.equal(calls[0].messageIds[0], 50);
  assert.equal(calls[0].messageIds.at(-1), 1);
});

test('/clear stops immediately on 429 and honors retry_after cooldown without extra Telegram calls', async () => {
  __clearTestUtils.clearCooldownUntilByChat.clear();
  let deleteCalls = 0;
  let sendCalls = 0;
  const rateLimitError = new Error('ETELEGRAM: 429 Too Many Requests: retry after 60');
  rateLimitError.response = {
    statusCode: 429,
    body: { error_code: 429, parameters: { retry_after: 60 } },
  };
  const bot = {
    deleteMessages: async () => {
      deleteCalls += 1;
      throw rateLimitError;
    },
    sendMessage: async () => {
      sendCalls += 1;
    },
  };
  const msg = { chat: { id: CHAT_ID }, message_id: 500 };

  await handleClearCommand(bot, msg);
  await handleClearCommand(bot, msg);

  assert.equal(deleteCalls, 1);
  assert.equal(sendCalls, 0);
  assert.ok(__clearTestUtils.clearCooldownUntilByChat.get(String(CHAT_ID)) > Date.now());

  __clearTestUtils.clearCooldownUntilByChat.clear();
});

test('retry_after can be extracted from Telegram error text as a fallback', () => {
  const error = new Error('ETELEGRAM: 429 Too Many Requests: retry after 843');
  assert.equal(__clearTestUtils.getRetryAfterSeconds(error), 843);
  assert.equal(__clearTestUtils.isRateLimitError(error), true);
});
