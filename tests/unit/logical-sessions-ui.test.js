import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-logical-sessions-'));

const { initDatabase } = await import('../../src/database/index.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { ProviderSessionRepository } = await import('../../src/sessions/provider-session-repository.js');
const { handleSessionsCommand, handleSessionsCallback } = await import('../../src/telegram/commands/sessions.js');

initDatabase();

function createBot() {
  const sent = [];
  const edited = [];
  const answered = [];
  return {
    sent,
    edited,
    answered,
    async sendMessage(chatId, text, options) {
      sent.push({ chatId, text, options });
      return { message_id: sent.length };
    },
    async editMessageText(text, options) {
      edited.push({ text, options });
      return true;
    },
    async answerCallbackQuery(id, options = {}) {
      answered.push({ id, options });
      return true;
    }
  };
}

const userId = 19001;
const first = SessionManager.createSession(userId, { title: 'Logical A', provider: 'codex' });
ProviderSessionRepository.bind({ sessionId: first.id, provider: 'codex', nativeSessionRef: 'codex-thread-a' });
ProviderSessionRepository.bind({ sessionId: first.id, provider: 'antigravity', nativeSessionRef: 'agy-conversation-a' });
const second = SessionManager.createSession(userId, { title: 'Logical B', provider: 'antigravity' });
ProviderSessionRepository.bind({ sessionId: second.id, provider: 'antigravity', nativeSessionRef: 'agy-conversation-b' });

// Put A back as current so the test can switch to B explicitly.
SessionManager.setActiveSession(userId, first.id);

test('/sessions lists Agent Hub logical sessions regardless of active provider', async () => {
  const bot = createBot();
  await handleSessionsCommand(bot, { chat: { id: 1 }, from: { id: userId } });

  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /Agent Hub/);
  assert.match(bot.sent[0].text, /Logical Session 2개/);
  const callbacks = bot.sent[0].options.reply_markup.inline_keyboard.flat().map((button) => button.callback_data);
  assert.ok(callbacks.includes(`session_info:${first.id}:ACTIVE:0`));
  assert.ok(callbacks.includes(`session_info:${second.id}:ACTIVE:0`));
  assert.equal(callbacks.some((value) => value?.startsWith('native_pick:')), false);
  assert.equal(callbacks.some((value) => value?.startsWith('native_map:')), false);
});

test('switching sessions changes only the Agent Hub logical session', async () => {
  const bot = createBot();
  await handleSessionsCallback(bot, {
    id: 'cb-switch',
    data: `session_switch:${second.id}:0`,
    from: { id: userId },
    message: { chat: { id: 1 }, message_id: 10 }
  });

  assert.equal(SessionManager.getActiveSession(userId).id, second.id);
  assert.equal(ProviderSessionRepository.get(second.id, 'antigravity').native_session_ref, 'agy-conversation-b');
  assert.equal(ProviderSessionRepository.get(first.id, 'codex').native_session_ref, 'codex-thread-a');
  assert.equal(ProviderSessionRepository.get(first.id, 'antigravity').native_session_ref, 'agy-conversation-a');
});

test('legacy native direct-pick callback no longer adopts a new logical session', async () => {
  const before = SessionManager.listSessions(userId, 'ACTIVE').length;
  const bot = createBot();
  await handleSessionsCallback(bot, {
    id: 'cb-native-pick',
    data: 'native_pick:codex:unmapped-thread',
    from: { id: userId },
    message: { chat: { id: 1 }, message_id: 11 }
  });

  assert.equal(SessionManager.listSessions(userId, 'ACTIVE').length, before);
  assert.equal(bot.answered.at(-1).options.show_alert, true);
  assert.match(bot.answered.at(-1).options.text, /직접 선택은 비활성화/);
});
