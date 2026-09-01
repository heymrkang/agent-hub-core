import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-settings-defaults-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { initSettingsManager, getSettingsManager } = await import('../../src/settings/settings-manager.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { handleNewCommand } = await import('../../src/telegram/commands/new.js');

initDatabase();
initSettingsManager();
const db = getDb();
const settings = getSettingsManager();

function cacheModel(provider, modelId, efforts) {
  db.prepare(`INSERT INTO provider_models(provider,model_id,display_name,is_default,metadata_json) VALUES(?,?,?,?,?)`)
    .run(provider, modelId, modelId, 1, JSON.stringify({ reasoningEfforts: efforts, defaultReasoningEffort: efforts[0] || null }));
}

function createBot() {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text, options) {
      sent.push({ chatId, text, options });
      return { message_id: sent.length };
    }
  };
}

test('Provider별 기본 Model / Thinking 설정을 settings 테이블에 영속 저장한다', () => {
  settings.set('default_model_codex', 'gpt-test');
  settings.set('default_reasoning_effort_codex', 'high');
  settings.set('default_model_antigravity', 'gemini-test');
  settings.set('default_reasoning_effort_antigravity', 'medium');

  assert.equal(settings.get('default_model_codex'), 'gpt-test');
  assert.equal(settings.get('default_reasoning_effort_codex'), 'high');
  assert.equal(settings.get('default_model_antigravity'), 'gemini-test');
  assert.equal(settings.get('default_reasoning_effort_antigravity'), 'medium');
});

test('/new가 선택된 Provider의 기본 Model / Thinking을 새 세션에 적용한다', async () => {
  cacheModel('codex', 'gpt-default-test', ['low', 'high']);
  settings.set('default_provider', 'codex');
  settings.set('default_model_codex', 'gpt-default-test');
  settings.set('default_reasoning_effort_codex', 'high');
  settings.set('default_execution_profile', 'FULL_ACCESS');

  const bot = createBot();
  await handleNewCommand(bot, { chat: { id: 2001 }, from: { id: 2001 } });

  const session = SessionManager.getActiveSession(2001);
  assert.equal(session.active_provider, 'codex');
  assert.equal(session.active_model, 'gpt-default-test');
  assert.equal(session.reasoning_effort, 'high');
  assert.equal(session.execution_profile, 'FULL_ACCESS');
  assert.match(bot.sent[0].text, /Thinking.*high/s);
});

test('/new는 저장된 Thinking이 현재 모델에서 유효하지 않으면 default로 안전하게 fallback한다', async () => {
  cacheModel('antigravity', 'gemini-default-test', ['low', 'medium']);
  settings.set('default_provider', 'antigravity');
  settings.set('default_model_antigravity', 'gemini-default-test');
  settings.set('default_reasoning_effort_antigravity', 'high');

  const bot = createBot();
  await handleNewCommand(bot, { chat: { id: 2002 }, from: { id: 2002 } });

  const session = SessionManager.getActiveSession(2002);
  assert.equal(session.active_provider, 'antigravity');
  assert.equal(session.active_model, 'gemini-default-test');
  assert.equal(session.reasoning_effort, 'default');
});

test('SessionManager.createSession이 reasoningEffort 옵션을 직접 보존한다', () => {
  const session = SessionManager.createSession(2003, {
    provider: 'codex',
    model: 'gpt-direct-test',
    reasoningEffort: 'minimal',
    profile: 'WORKSPACE'
  });
  assert.equal(session.reasoning_effort, 'minimal');
});
