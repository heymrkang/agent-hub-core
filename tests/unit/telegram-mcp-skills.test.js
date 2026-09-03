import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-mcp-cmd-test-'));
process.env.DATA_DIR = tempBase;
process.env.CODEX_CONFIG_PATH = path.join(tempBase, 'codex-config.toml');
process.env.GEMINI_CONFIG_PATH = path.join(tempBase, 'gemini-mcp.json');
process.env.CODEX_SKILLS_DIR = path.join(tempBase, 'codex-skills');
process.env.GEMINI_SKILLS_DIR = path.join(tempBase, 'gemini-skills');
process.env.SKILLS_MASTER_DIR = path.join(tempBase, 'skills');

const { initDatabase } = await import('../../src/database/index.js');
const { McpRepository } = await import('../../src/extensions/mcp-repository.js');
const { skillRepository } = await import('../../src/extensions/skill-repository.js');
const {
  buildMcpListView,
  buildMcpDetailView,
  handleMcpCommand,
  handleMcpCallback
} = await import('../../src/telegram/commands/mcp.js');
const {
  buildSkillsListView,
  handleSkillsCommand,
  handleSkillsCallback
} = await import('../../src/telegram/commands/skills.js');

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

test('buildMcpListView returns markdown and preset buttons', () => {
  const view = buildMcpListView();
  assert.match(view.text, /MCP 서버 관리/);
  assert.equal(Array.isArray(view.reply_markup.inline_keyboard), true);

  const flatButtons = view.reply_markup.inline_keyboard.flat();
  assert.equal(flatButtons.some((b) => b.text === '+ GitHub'), true);
  assert.equal(flatButtons.some((b) => b.text === '+ Fetch'), true);
  assert.equal(flatButtons.some((b) => b.text.includes('동기화')), true);
});

test('handleMcpCommand adds, toggles, removes, and syncs MCP servers', async () => {
  const bot = createMockBot();
  const msg = { chat: { id: 123 }, from: { id: 456 } };

  // 1. List
  await handleMcpCommand(bot, msg, '');
  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /MCP 서버 관리/);

  // 2. Add stdio server
  await handleMcpCommand(bot, msg, 'add test-cli npx -y test-pkg --env TOKEN_A,TOKEN_B');
  assert.equal(bot.sent.length, 2);
  assert.match(bot.sent[1].text, /등록 및 동기화 완료/);

  const server = McpRepository.getByName('test-cli');
  assert.equal(server.name, 'test-cli');
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', 'test-pkg']);
  assert.deepEqual(server.envKeys, ['TOKEN_A', 'TOKEN_B']);
  assert.equal(server.enabled, true);

  // 3. Toggle
  await handleMcpCommand(bot, msg, 'toggle test-cli');
  assert.equal(bot.sent.length, 3);
  assert.match(bot.sent[2].text, /비활성화/);
  assert.equal(McpRepository.getByName('test-cli').enabled, false);

  // 4. Sync
  await handleMcpCommand(bot, msg, 'sync');
  assert.equal(bot.sent.length, 4);
  assert.match(bot.sent[3].text, /동기화 완료/);

  // 5. Remove
  await handleMcpCommand(bot, msg, 'remove test-cli');
  assert.equal(bot.sent.length, 5);
  assert.match(bot.sent[4].text, /삭제되었습니다/);
  assert.equal(McpRepository.getByName('test-cli'), null);
});

test('handleMcpCallback handles preset addition, toggle, detail view, and deletion', async () => {
  const bot = createMockBot();
  const query = {
    id: 'query-1',
    message: { chat: { id: 123 }, message_id: 200 },
    data: 'mcp_preset:memory'
  };

  // 1. Add preset
  await handleMcpCallback(bot, query);
  assert.equal(bot.answered.length, 1);
  assert.match(bot.answered[0].options.text, /프리셋이 추가되었습니다/);

  const memoryServer = McpRepository.getByName('memory');
  assert.notEqual(memoryServer, null);
  assert.equal(memoryServer.name, 'memory');

  // 2. View detail
  query.data = `mcp_view:${memoryServer.id}`;
  await handleMcpCallback(bot, query);
  assert.match(bot.edited.at(-1).text, /MCP 상세 · memory/);

  // 3. Toggle
  query.data = `mcp_toggle:${memoryServer.id}`;
  await handleMcpCallback(bot, query);
  assert.equal(McpRepository.getById(memoryServer.id).enabled, false);

  // 4. Delete
  query.data = `mcp_delete:${memoryServer.id}`;
  await handleMcpCallback(bot, query);
  assert.equal(McpRepository.getByName('memory'), null);
});

test('buildSkillsListView and handleSkillsCommand report skills and sync', async () => {
  const bot = createMockBot();
  const msg = { chat: { id: 123 }, from: { id: 456 } };

  // Save a dummy skill
  skillRepository.saveSkill('ci-check', {
    name: 'ci-check',
    description: 'Checks CI status'
  });

  const view = buildSkillsListView();
  assert.match(view.text, /Agent Skills 관리/);
  assert.match(view.text, /ci-check/);

  // Run /skills
  await handleSkillsCommand(bot, msg, '');
  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0].text, /ci-check/);

  // Run /skills sync
  await handleSkillsCommand(bot, msg, 'sync');
  assert.equal(bot.sent.length, 2);
  assert.match(bot.sent[1].text, /Skills Provider 전체 동기화 완료/);

  // Clean up
  skillRepository.deleteSkill('ci-check');
});
