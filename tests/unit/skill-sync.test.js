import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const {
  SkillRepository,
  parseSkillFrontmatter
} = await import('../../src/extensions/skill-repository.js');
const {
  SkillSyncService
} = await import('../../src/extensions/skill-sync-service.js');

test('parseSkillFrontmatter extracts YAML frontmatter and body accurately', () => {
  const markdown = `---
name: test-skill
description: >-
  This is a multi-line description
  explaining the skill.
---

# Test Skill Instructions
Run this step first.
`;

  const parsed = parseSkillFrontmatter(markdown);
  assert.equal(parsed.attributes.name, 'test-skill');
  assert.equal(parsed.attributes.description, 'This is a multi-line description explaining the skill.');
  assert.match(parsed.body, /# Test Skill Instructions/);
});

test('parseSkillFrontmatter handles plain content without frontmatter', () => {
  const plain = '# Just Instructions\nDo something.';
  const parsed = parseSkillFrontmatter(plain);
  assert.deepEqual(parsed.attributes, {});
  assert.equal(parsed.body, plain);
});

test('SkillRepository manages skills and provides progressive disclosure metadata', () => {
  const tmpMaster = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-master-'));
  const repo = new SkillRepository(tmpMaster);

  // 1. Save skill
  const saved = repo.saveSkill('deploy-helper', {
    name: 'deploy-helper',
    description: 'Automates deployment checks',
    skillMdContent: `---
name: deploy-helper
description: Automates deployment checks
---
# Deployment Helper
Run git status and checks.
`
  });

  assert.equal(saved.name, 'deploy-helper');
  assert.equal(saved.dirName, 'deploy-helper');
  assert.equal(saved.description, 'Automates deployment checks');
  assert.equal(saved.valid, true);
  assert.equal(saved.filesCount, 1);

  // 2. List
  const list = repo.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'deploy-helper');

  // 3. Get by name
  const found = repo.getByName('deploy-helper');
  assert.equal(found.dirName, 'deploy-helper');

  // 4. Delete
  const deleted = repo.deleteSkill('deploy-helper');
  assert.equal(deleted, true);
  assert.equal(repo.list().length, 0);

  fs.rmSync(tmpMaster, { recursive: true, force: true });
});

test('SkillSyncService mirrors skills to both Codex and Antigravity, and cleans up orphans', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-sync-test-'));
  const masterDir = path.join(tmpDir, 'master');
  const codexDir = path.join(tmpDir, 'codex');
  const geminiDir = path.join(tmpDir, 'gemini');

  const repo = new SkillRepository(masterDir);
  const syncService = new SkillSyncService({
    repository: repo,
    codexSkillsDir: codexDir,
    geminiSkillsDir: geminiDir
  });

  // Pre-seed a system directory in Codex that should be preserved
  fs.mkdirSync(path.join(codexDir, '.system'), { recursive: true });
  fs.writeFileSync(path.join(codexDir, '.system', 'preserved.txt'), 'keep me');

  // Add 2 skills to master
  repo.saveSkill('db-backup', {
    name: 'db-backup',
    description: 'MariaDB backup assistant'
  });
  repo.saveSkill('log-analyzer', {
    name: 'log-analyzer',
    description: 'Nginx log analyzer'
  });

  // Sync
  const result = syncService.syncAll();
  assert.equal(result.skillsCount, 2);
  assert.equal(result.codex.syncedCount, 2);
  assert.equal(result.gemini.syncedCount, 2);

  // Verify files exist in both destinations
  assert.equal(fs.existsSync(path.join(codexDir, 'db-backup', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(geminiDir, 'db-backup', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(codexDir, 'log-analyzer', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(geminiDir, 'log-analyzer', 'SKILL.md')), true);
  // Verify .system in Codex is preserved
  assert.equal(fs.existsSync(path.join(codexDir, '.system', 'preserved.txt')), true);

  // Delete 1 skill from master and re-sync
  repo.deleteSkill('log-analyzer');
  assert.equal(repo.list().length, 1);

  syncService.syncAll();

  // Verify db-backup remains, log-analyzer is removed
  assert.equal(fs.existsSync(path.join(codexDir, 'db-backup', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(geminiDir, 'db-backup', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(codexDir, 'log-analyzer')), false);
  assert.equal(fs.existsSync(path.join(geminiDir, 'log-analyzer')), false);
  assert.equal(fs.existsSync(path.join(codexDir, '.system', 'preserved.txt')), true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
