import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-mcp-test-'));

const { initDatabase, getDb } = await import('../../src/database/index.js');
const { McpRepository } = await import('../../src/extensions/mcp-repository.js');
const {
  McpSyncService,
  stripMcpSectionsFromToml,
  buildCodexMcpToml,
  buildGeminiMcpConfig
} = await import('../../src/extensions/mcp-sync-service.js');

initDatabase();
const db = getDb();

test('migration 016 creates mcp_servers table with correct schema', () => {
  const columns = new Set(db.prepare('PRAGMA table_info(mcp_servers)').all().map((c) => c.name));
  for (const name of ['id', 'name', 'transport', 'command', 'args_json', 'url', 'env_keys_json', 'headers_json', 'enabled', 'description', 'created_at', 'updated_at']) {
    assert.equal(columns.has(name), true, `Column ${name} should exist`);
  }
});

test('McpRepository creates, reads, updates, toggles, and deletes MCP servers', () => {
  // 1. Create stdio server
  const stdioServer = McpRepository.create({
    name: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    description: 'GitHub MCP Server'
  });

  assert.equal(stdioServer.name, 'github');
  assert.equal(stdioServer.transport, 'stdio');
  assert.equal(stdioServer.command, 'npx');
  assert.deepEqual(stdioServer.args, ['-y', '@modelcontextprotocol/server-github']);
  assert.deepEqual(stdioServer.envKeys, ['GITHUB_PERSONAL_ACCESS_TOKEN']);
  assert.equal(stdioServer.enabled, true);

  // 2. Create HTTP server
  const httpServer = McpRepository.create({
    name: 'remote-api',
    transport: 'http',
    url: 'https://mcp.example.com/sse',
    headers: { Authorization: 'Bearer token-123' },
    description: 'Remote HTTP MCP'
  });

  assert.equal(httpServer.name, 'remote-api');
  assert.equal(httpServer.transport, 'http');
  assert.equal(httpServer.url, 'https://mcp.example.com/sse');
  assert.deepEqual(httpServer.headers, { Authorization: 'Bearer token-123' });

  // 3. List
  const all = McpRepository.list();
  assert.equal(all.length >= 2, true);
  assert.equal(all.some((s) => s.name === 'github'), true);
  assert.equal(all.some((s) => s.name === 'remote-api'), true);

  // 4. Toggle
  const toggled = McpRepository.toggle(stdioServer.id);
  assert.equal(toggled.enabled, false);

  const enabledList = McpRepository.list({ enabledOnly: true });
  assert.equal(enabledList.some((s) => s.name === 'github'), false);
  assert.equal(enabledList.some((s) => s.name === 'remote-api'), true);

  // 5. Update
  const updated = McpRepository.update(stdioServer.id, { description: 'Updated description', enabled: true });
  assert.equal(updated.description, 'Updated description');
  assert.equal(updated.enabled, true);

  // 6. Delete
  const deleted = McpRepository.delete(httpServer.id);
  assert.equal(deleted, true);
  assert.equal(McpRepository.getById(httpServer.id), null);

  // Clean up github
  McpRepository.delete(stdioServer.id);
});

test('McpRepository enforces validation rules', () => {
  assert.throws(() => McpRepository.create({ name: '' }), /이름이 필요합니다/);
  assert.throws(() => McpRepository.create({ name: 'INVALID NAME!' }), /영소문자/);
  assert.throws(() => McpRepository.create({ name: 'bad-transport', transport: 'websocket' }), /transport/);
  assert.throws(() => McpRepository.create({ name: 'missing-cmd', transport: 'stdio' }), /command/);
  assert.throws(() => McpRepository.create({ name: 'missing-url', transport: 'http' }), /url/);
});

test('stripMcpSectionsFromToml strips mcp_servers sections while preserving base config', () => {
  const existingToml = `
model = "gpt-5.6-sol"
model_reasoning_effort = "low"

[projects."/workspace"]
trust_level = "trusted"

[mcp_servers.old_server]
command = "echo"
args = ["old"]

[mcp_servers.old_server.env]
FOO = "BAR"

[projects."/home/dev"]
trust_level = "trusted"
`.trim();

  const stripped = stripMcpSectionsFromToml(existingToml);
  assert.match(stripped, /model = "gpt-5\.6-sol"/);
  assert.match(stripped, /\[projects\."\/workspace"\]/);
  assert.match(stripped, /\[projects\."\/home\/dev"\]/);
  assert.doesNotMatch(stripped, /old_server/);
});

test('buildCodexMcpToml formats stdio and http servers with env and enabled flags', () => {
  const servers = [
    {
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'gh-mcp'],
      envKeys: ['MY_TOKEN'],
      enabled: true
    },
    {
      name: 'remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Auth': 'secret' },
      enabled: false
    }
  ];

  const toml = buildCodexMcpToml(servers, { MY_TOKEN: 'resolved-token-val' });

  assert.match(toml, /\[mcp_servers\.gh\]/);
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /args = \["-y","gh-mcp"\]/);
  assert.match(toml, /enabled = true/);
  assert.match(toml, /\[mcp_servers\.gh\.env\]/);
  assert.match(toml, /MY_TOKEN = "resolved-token-val"/);

  assert.match(toml, /\[mcp_servers\.remote\]/);
  assert.match(toml, /url = "https:\/\/example\.com\/mcp"/);
  assert.match(toml, /http_headers = \{"X-Auth":"secret"\}/);
  assert.match(toml, /enabled = false/);
});

test('buildGeminiMcpConfig formats JSON with stdio and http servers', () => {
  const servers = [
    {
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'gh-mcp'],
      envKeys: ['MY_TOKEN'],
      enabled: true
    },
    {
      name: 'remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Auth': 'secret' },
      enabled: false
    }
  ];

  const config = buildGeminiMcpConfig(servers, { existingKey: true }, { MY_TOKEN: 'resolved-token-val' });

  assert.equal(config.existingKey, true);
  assert.deepEqual(config.mcpServers.gh, {
    command: 'npx',
    args: ['-y', 'gh-mcp'],
    env: { MY_TOKEN: 'resolved-token-val' },
    disabled: false
  });
  assert.deepEqual(config.mcpServers.remote, {
    serverUrl: 'https://example.com/mcp',
    headers: { 'X-Auth': 'secret' },
    disabled: true
  });
});

test('McpSyncService writes atomic updates to both Codex and Antigravity configs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sync-files-'));
  const codexPath = path.join(tmpDir, 'codex.toml');
  const geminiPath = path.join(tmpDir, 'mcp_config.json');

  // Pre-seed base Codex config
  fs.writeFileSync(codexPath, 'model = "gpt-5.6-sol"\n[projects."/workspace"]\ntrust_level = "trusted"\n');

  // Add an MCP server to DB
  const server = McpRepository.create({
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/dev'],
    envKeys: ['SECRET_KEY'],
    enabled: true
  });

  const syncService = new McpSyncService({
    codexConfigPath: codexPath,
    geminiConfigPath: geminiPath,
    env: { SECRET_KEY: 'top-secret' }
  });

  const result = syncService.syncAll();
  assert.equal(result.serversCount >= 1, true);

  // Check Codex config
  const codexContent = fs.readFileSync(codexPath, 'utf8');
  assert.match(codexContent, /model = "gpt-5\.6-sol"/);
  assert.match(codexContent, /\[mcp_servers\.filesystem\]/);
  assert.match(codexContent, /command = "npx"/);
  assert.match(codexContent, /SECRET_KEY = "top-secret"/);
  assert.match(codexContent, /enabled = true/);

  // Check Gemini config
  const geminiContent = JSON.parse(fs.readFileSync(geminiPath, 'utf8'));
  assert.equal(geminiContent.mcpServers.filesystem.command, 'npx');
  assert.equal(geminiContent.mcpServers.filesystem.env.SECRET_KEY, 'top-secret');
  assert.equal(geminiContent.mcpServers.filesystem.disabled, false);

  // Toggle server and re-sync
  McpRepository.toggle(server.id);
  syncService.syncAll();

  const codexAfter = fs.readFileSync(codexPath, 'utf8');
  assert.match(codexAfter, /enabled = false/);

  const geminiAfter = JSON.parse(fs.readFileSync(geminiPath, 'utf8'));
  assert.equal(geminiAfter.mcpServers.filesystem.disabled, true);

  // Clean up
  McpRepository.delete(server.id);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
