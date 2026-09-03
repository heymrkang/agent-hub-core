import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-deploy-test-'));
process.env.DATA_DIR = tempBase;

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { DeployRepository } = await import('../../src/deploy/deploy-repository.js');
const {
  buildDeployListView,
  handleDeployCommand,
  handleDeployCallback
} = await import('../../src/telegram/commands/deploy.js');

initDatabase();

function createMockBot() {
  const sent = [];
  const edited = [];
  const answered = [];

  return {
    sent,
    edited,
    answered,
    async sendMessage(chatId, text, options = {}) {
      sent.push({ chatId, text, options });
      return { message_id: 100 + sent.length };
    },
    async editMessageText(text, options = {}) {
      edited.push({ text, options });
      return true;
    },
    async answerCallbackQuery(id, options = {}) {
      answered.push({ id, options });
      return true;
    }
  };
}

test('DeployRepository CRUD works correctly', () => {
  // 1. 유효성 검증
  assert.throws(() => DeployRepository.create({ name: '', webhookUrl: 'https://example.com' }), /이름이 필요합니다/);
  assert.throws(() => DeployRepository.create({ name: 'blog', webhookUrl: 'invalid-url' }), /올바른 Webhook URL/);

  // 2. 등록
  const target = DeployRepository.create({
    name: 'blog',
    webhookUrl: 'https://coolify.example.com/api/v1/deploy/uuid-123',
    description: 'HeyMrKang 블로그'
  });
  assert.equal(target.name, 'blog');
  assert.equal(target.webhookUrl, 'https://coolify.example.com/api/v1/deploy/uuid-123');
  assert.equal(target.description, 'HeyMrKang 블로그');

  // 3. 중복 검증
  assert.throws(() => DeployRepository.create({ name: 'blog', webhookUrl: 'https://example.com' }), /이미 존재하는 배포 타겟/);

  // 4. 단건 조회 및 목록
  const found = DeployRepository.findByName('blog');
  assert.equal(found.id, target.id);

  const list = DeployRepository.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'blog');

  // 5. 삭제
  const deleted = DeployRepository.delete('blog');
  assert.equal(deleted, true);
  assert.equal(DeployRepository.findByName('blog'), null);
});

test('DeployRepository.trigger calls fetch with POST and payload', async (t) => {
  DeployRepository.create({
    name: 'api',
    webhookUrl: 'https://coolify.example.com/webhook/test-api',
    description: 'API 서버'
  });

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  let fetchUrl = null;
  let fetchOptions = null;

  globalThis.fetch = async (url, options) => {
    fetchCalled = true;
    fetchUrl = url;
    fetchOptions = options;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'Deploy triggered'
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    DeployRepository.delete('api');
  });

  const res = await DeployRepository.trigger('api');
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(fetchCalled, true);
  assert.equal(fetchUrl, 'https://coolify.example.com/webhook/test-api');
  assert.equal(fetchOptions.method, 'POST');

  const body = JSON.parse(fetchOptions.body);
  assert.equal(body.target, 'api');
  assert.equal(body.source, 'agent-hub-telegram');
});

test('Telegram /deploy command and callback work end-to-end', async (t) => {
  const bot = createMockBot();
  const msg = { chat: { id: 12345 } };

  // 1. 빈 목록 뷰
  await handleDeployCommand(bot, msg, '');
  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /등록된 배포 대상이 없습니다/);

  // 2. /deploy add 등록
  await handleDeployCommand(bot, msg, 'add blog https://coolify.example.com/deploy-blog 블로그 배포');
  assert.equal(bot.sent.length, 2);
  assert.match(bot.sent[1].text, /배포 타겟이 등록되었습니다/);

  // 3. /deploy 목록 재조회 (버튼 확인)
  const view = buildDeployListView();
  assert.match(view.text, /blog/);
  const flatButtons = view.reply_markup.inline_keyboard.flat();
  assert.equal(flatButtons.some((b) => b.text.includes('blog')), true);

  // 4. /deploy blog 트리거 (fetch mock)
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK' });

  t.after(() => {
    globalThis.fetch = originalFetch;
    DeployRepository.delete('blog');
  });

  await handleDeployCommand(bot, msg, 'blog');
  assert.equal(bot.sent.length, 4); // 전송 중 + 전송 완료
  assert.match(bot.sent[3].text, /배포 요청 전송 완료/);

  // 5. 콜백 트리거
  await handleDeployCallback(bot, {
    id: 'cb_1',
    message: { chat: { id: 12345 }, message_id: 100 },
    data: 'deploy_trigger:blog'
  });
  assert.equal(bot.answered.length, 1);
  assert.match(bot.sent[4].text, /배포 요청 전송 완료/);

  // 6. /deploy remove 삭제
  await handleDeployCommand(bot, msg, 'remove blog');
  assert.equal(bot.sent.length, 6);
  assert.match(bot.sent[5].text, /삭제되었습니다/);
});
