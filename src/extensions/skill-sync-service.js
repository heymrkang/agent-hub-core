import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { skillRepository } from './skill-repository.js';

function getCodexSkillsDir() {
  if (process.env.CODEX_SKILLS_DIR) return process.env.CODEX_SKILLS_DIR;
  if (process.env.CODEX_HOME) return path.join(process.env.CODEX_HOME, 'skills');
  return path.join(os.homedir(), '.codex', 'skills');
}

function getGeminiSkillsDir() {
  if (process.env.GEMINI_SKILLS_DIR) return process.env.GEMINI_SKILLS_DIR;
  const home = process.env.GEMINI_HOME || path.join(os.homedir(), '.gemini');
  return path.join(home, 'config', 'skills');
}

function syncToTarget(skills, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const validDirNames = new Set();

  for (const skill of skills) {
    if (!skill.valid || !fs.existsSync(skill.dirPath)) continue;
    validDirNames.add(skill.dirName);
    const dest = path.join(targetDir, skill.dirName);
    fs.cpSync(skill.dirPath, dest, { recursive: true, force: true });
  }

  // Remove orphaned directories (preserve hidden/system dirs like .system)
  try {
    const existing = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of existing) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (!validDirNames.has(entry.name)) {
        fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.warn(`[SkillSync] orphaned 정리 경고 (${targetDir}): ${err.message}`);
  }

  return { targetDir, syncedCount: validDirNames.size };
}

export class SkillSyncService {
  constructor({
    repository = skillRepository,
    codexSkillsDir = null,
    geminiSkillsDir = null
  } = {}) {
    this.repository = repository;
    this.codexSkillsDir = codexSkillsDir || getCodexSkillsDir();
    this.geminiSkillsDir = geminiSkillsDir || getGeminiSkillsDir();
  }

  syncCodex(skills) {
    return syncToTarget(skills, this.codexSkillsDir);
  }

  syncGemini(skills) {
    return syncToTarget(skills, this.geminiSkillsDir);
  }

  syncAll() {
    const skills = this.repository.list().filter((s) => s.valid);
    const codex = this.syncCodex(skills);
    const gemini = this.syncGemini(skills);
    return {
      syncedAt: new Date().toISOString(),
      skillsCount: skills.length,
      codex,
      gemini
    };
  }
}

export const skillSyncService = new SkillSyncService();
