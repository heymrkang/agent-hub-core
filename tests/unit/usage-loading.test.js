import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-usage-loading-'));

const { initDatabase } = await import('../../src/database/index.js');
const { providerManager } = await import('../../src/providers/provider-manager.js');
const { handleUsageCommand } = await import('../../src/telegram/commands/usage.js');

initDatabase();

test('/usage sends a checking message first and edits it with the result', async () => {
  const originalListProviderNames = providerManager.listProviderNames;
  providerManager.listProviderNames = () => [];

  const calls = [];
  const bot = {
    sendMessage: async (chatId, text) => {
      calls.push({ method: 'sendMessage', chatId, text });
      return { message_id: 777 };
    },
    editMessageText: async (text, options) => {
      calls.push({ method: 'editMessageText', text, options });
      return true;
    }
  };

  try {
    await handleUsageCommand(bot, { chat: { id: 123 }, from: { id: 456 } });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'sendMessage');
    assert.match(calls[0].text, /Usage 확인 중/);
    assert.equal(calls[1].method, 'editMessageText');
    assert.equal(calls[1].options.chat_id, 123);
    assert.equal(calls[1].options.message_id, 777);
    assert.match(calls[1].text, /Agent Hub Usage/);
  } finally {
    providerManager.listProviderNames = originalListProviderNames;
  }
});
