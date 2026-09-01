import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-reasoning-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { SessionManager } = await import('../../src/sessions/session-manager.js');
const { modelCatalog } = await import('../../src/providers/model-catalog.js');
const { CodexAdapter } = await import('../../src/providers/codex/codex-adapter.js');
const { AntigravityAdapter } = await import('../../src/providers/antigravity/antigravity-adapter.js');
const { HandoffManager } = await import('../../src/context/handoff-manager.js');

initDatabase();
const db = getDb();

function cacheModel(provider, model, efforts) {
  db.prepare(`INSERT INTO provider_models(provider,model_id,display_name,is_default,metadata_json) VALUES(?,?,?,?,?)`)
    .run(provider, model, model, 1, JSON.stringify({ reasoningEfforts: efforts, defaultReasoningEffort: efforts[0] || null }));
}

test('Codex restricted/FULL_ACCESS와 Antigravity가 같은 Thinking 인자 규칙을 쓴다', () => {
  const codex = new CodexAdapter();
  assert.deepEqual(codex.buildCodexArgs({ prompt: 'p', model: 'gpt-x', reasoningEffort: 'high' }).slice(0, 6), ['exec', '-m', 'gpt-x', '-c', 'model_reasoning_effort="high"', '--skip-git-repo-check']);
  assert.equal(codex.buildCodexArgs({ prompt: 'p', model: 'gpt-x', reasoningEffort: 'default' }).includes('-c'), false);

  const agy = new AntigravityAdapter();
  const high = agy.buildArgs({ prompt: 'p', model: 'gemini-x', reasoningEffort: 'high' });
  assert.deepEqual(high.slice(high.indexOf('--effort'), high.indexOf('--effort') + 2), ['--effort', 'high']);
  assert.equal(agy.buildArgs({ prompt: 'p', model: 'gemini-x', reasoningEffort: 'default' }).includes('--effort'), false);
});

test('Codex model/list의 모델별 reasoning metadata를 보존한다', async () => {
  const codex = new CodexAdapter();
  codex.queryAppServerModels = async () => ({ data: [{
    model: 'gpt-test',
    displayName: 'GPT Test',
    supportedReasoningEfforts: [{ reasoningEffort: 'minimal' }, { reasoningEffort: 'high' }],
    defaultReasoningEffort: 'minimal'
  }] });
  const [model] = await codex.discoverModels(true);
  assert.deepEqual(model.metadata, { reasoningEfforts: ['minimal', 'high'], defaultReasoningEffort: 'minimal' });
});

test('모델 metadata에 있는 Thinking만 허용한다', () => {
  cacheModel('reasoning-test', 'model-a', ['low', 'high']);
  assert.deepEqual(modelCatalog.getReasoningOptions('reasoning-test', 'model-a').levels, ['default', 'low', 'high']);
  assert.equal(modelCatalog.validateReasoningEffort('reasoning-test', 'model-a', 'high'), 'high');
  assert.throws(() => modelCatalog.validateReasoningEffort('reasoning-test', 'model-a', 'medium'), /지원하지 않습니다/);
});

test('같은 Provider의 Thinking 변경은 handoff 기록 없이 세션에 원자 적용된다', async () => {
  const session = SessionManager.createSession(1604, { provider: 'codex', model: 'model-a' });
  await HandoffManager.executeHandoff({ sessionId: session.id, fromProvider: 'codex', toProvider: 'codex', targetModel: 'model-a', reasoningEffort: 'high' });
  const updated = SessionManager.getSession(session.id);
  assert.equal(updated.active_provider, 'codex');
  assert.equal(updated.active_model, 'model-a');
  assert.equal(updated.reasoning_effort, 'high');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM provider_handoffs WHERE session_id=?').get(session.id).count, 0);
});
