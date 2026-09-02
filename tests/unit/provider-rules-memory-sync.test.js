import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-memory-rules-'));
process.env.DATA_DIR = path.join(root, 'data');
process.env.CODEX_HOME = path.join(root, 'codex');
process.env.GEMINI_HOME = path.join(root, 'gemini');

const { initDatabase } = await import('../../src/database/index.js');
const { MemoryManager, MEMORY_START, MEMORY_END } = await import('../../src/memory/memory-manager.js');

initDatabase();

const codexRules = path.join(process.env.CODEX_HOME, 'AGENTS.md');
const antigravityRules = path.join(process.env.GEMINI_HOME, 'GEMINI.md');

function managedBlock(content) {
  const start = content.indexOf(MEMORY_START);
  const end = content.indexOf(MEMORY_END);
  assert.ok(start >= 0, 'managed start marker missing');
  assert.ok(end > start, 'managed end marker missing');
  return content.slice(start + MEMORY_START.length, end).trim();
}

test('memory mutation mirrors the same managed block to Codex and Antigravity while preserving user rules', () => {
  fs.mkdirSync(path.dirname(codexRules), { recursive: true });
  fs.mkdirSync(path.dirname(antigravityRules), { recursive: true });
  fs.writeFileSync(codexRules, '# Personal Codex Rules\n\n- keep codex custom rule\n', 'utf-8');
  fs.writeFileSync(antigravityRules, '# Personal Gemini Rules\n\n- keep agy custom rule\n', 'utf-8');

  const canonical = '# Agent Hub Global Memory\n\n- 항상 한국어로 답한다.\n- 작업 전 기존 코드를 확인한다.\n';
  const result = MemoryManager.writeMemoryFile(canonical, 'UPDATE', 'USER');

  assert.equal(result.length, 2);
  const codex = fs.readFileSync(codexRules, 'utf-8');
  const antigravity = fs.readFileSync(antigravityRules, 'utf-8');

  assert.match(codex, /Personal Codex Rules/);
  assert.match(codex, /keep codex custom rule/);
  assert.match(antigravity, /Personal Gemini Rules/);
  assert.match(antigravity, /keep agy custom rule/);
  assert.equal(managedBlock(codex), canonical.trim());
  assert.equal(managedBlock(antigravity), canonical.trim());
});

test('re-sync replaces only the managed block and never duplicates markers', () => {
  MemoryManager.writeMemoryFile('# Agent Hub Global Memory\n\n- 첫 번째 규칙\n', 'UPDATE', 'USER');
  MemoryManager.writeMemoryFile('# Agent Hub Global Memory\n\n- 두 번째 규칙\n', 'UPDATE', 'USER');

  for (const filePath of [codexRules, antigravityRules]) {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.equal(content.split(MEMORY_START).length - 1, 1);
    assert.equal(content.split(MEMORY_END).length - 1, 1);
    assert.match(managedBlock(content), /두 번째 규칙/);
    assert.doesNotMatch(managedBlock(content), /첫 번째 규칙/);
  }
});

test('append and clear keep both provider rules synchronized with canonical memory', () => {
  MemoryManager.writeMemoryFile('# Agent Hub Global Memory\n\n', 'UPDATE', 'USER');
  MemoryManager.appendEntry('숫자 777을 기억한다.');

  const canonicalAfterAppend = MemoryManager.getMemoryContent().trim();
  assert.equal(managedBlock(fs.readFileSync(codexRules, 'utf-8')), canonicalAfterAppend);
  assert.equal(managedBlock(fs.readFileSync(antigravityRules, 'utf-8')), canonicalAfterAppend);

  MemoryManager.clearMemory();
  const canonicalAfterClear = MemoryManager.getMemoryContent().trim();
  assert.equal(managedBlock(fs.readFileSync(codexRules, 'utf-8')), canonicalAfterClear);
  assert.equal(managedBlock(fs.readFileSync(antigravityRules, 'utf-8')), canonicalAfterClear);
});

test('V2 prompt compatibility method returns null because provider native rules own global memory', () => {
  assert.equal(MemoryManager.getMemoryForPrompt(), null);
});
