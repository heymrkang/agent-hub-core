import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '../database/index.js';

const MEMORY_START = '<!-- AGENT_HUB_MEMORY_START -->';
const MEMORY_END = '<!-- AGENT_HUB_MEMORY_END -->';

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function replaceManagedBlock(existingContent, memoryContent) {
  const existing = String(existingContent || '');
  const managed = `${MEMORY_START}\n${String(memoryContent || '').trim()}\n${MEMORY_END}`;
  const start = existing.indexOf(MEMORY_START);
  const end = existing.indexOf(MEMORY_END);

  if (start >= 0 && end >= start) {
    const before = existing.slice(0, start).replace(/\s+$/, '');
    const after = existing.slice(end + MEMORY_END.length).replace(/^\s+/, '');
    return [before, managed, after].filter(Boolean).join('\n\n').trimEnd() + '\n';
  }

  const preserved = existing.trimEnd();
  return `${preserved ? `${preserved}\n\n` : ''}${managed}\n`;
}

export class MemoryManager {
  static getMemoryDir() {
    const dataDir = process.env.DATA_DIR || '/data';
    const memDir = path.join(dataDir, 'memory');
    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
    return memDir;
  }

  static getMemoryFilePath() {
    return path.join(this.getMemoryDir(), 'MEMORY.md');
  }

  static getAuditFilePath() {
    return path.join(this.getMemoryDir(), 'audit.jsonl');
  }

  static getProviderRulesTargets() {
    const home = os.homedir();
    const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
    const geminiHome = process.env.GEMINI_HOME || path.join(home, '.gemini');
    return [
      { provider: 'codex', path: process.env.CODEX_GLOBAL_RULES_PATH || path.join(codexHome, 'AGENTS.md') },
      { provider: 'antigravity', path: process.env.ANTIGRAVITY_GLOBAL_RULES_PATH || path.join(geminiHome, 'GEMINI.md') }
    ];
  }

  static getMemoryContent() {
    const filePath = this.getMemoryFilePath();
    if (!fs.existsSync(filePath)) {
      const defaultTemplate = `# Agent Hub Global Memory\n\n- 사용자 선호: 직설적인 디시 톤\n- 시스템 역할: Agent Hub 코어 어시스턴트\n`;
      this.writeMemoryFile(defaultTemplate, 'INIT', 'SYSTEM');
      return defaultTemplate;
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  static syncProviderRules(memoryContent = null) {
    const content = memoryContent ?? this.getMemoryContent();
    const targets = this.getProviderRulesTargets();
    const snapshots = targets.map((target) => ({
      ...target,
      existed: fs.existsSync(target.path),
      previous: fs.existsSync(target.path) ? fs.readFileSync(target.path, 'utf-8') : ''
    }));

    const written = [];
    try {
      for (const target of snapshots) {
        const next = replaceManagedBlock(target.previous, content);
        atomicWrite(target.path, next);
        written.push(target);
      }
    } catch (error) {
      for (const target of written.reverse()) {
        try {
          if (target.existed) atomicWrite(target.path, target.previous);
          else if (fs.existsSync(target.path)) fs.unlinkSync(target.path);
        } catch (rollbackError) {
          console.error(`[MemorySync] rollback 실패 provider=${target.provider}: ${rollbackError.message}`);
        }
      }
      throw new Error(`Provider Rules 동기화 실패: ${error.message}`);
    }

    const result = targets.map((target) => ({ provider: target.provider, path: target.path, status: 'SYNCED' }));
    console.log(`[MemorySync] provider rules 동기화 완료: ${result.map((item) => `${item.provider}=${item.path}`).join(', ')}`);
    return result;
  }

  static writeMemoryFile(newContent, action = 'UPDATE', source = 'USER') {
    const memDir = this.getMemoryDir();
    const filePath = this.getMemoryFilePath();
    const prevContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const normalized = String(newContent ?? '');

    const tmpPath = path.join(memDir, `MEMORY.tmp.${Date.now()}`);
    fs.writeFileSync(tmpPath, normalized, 'utf-8');
    fs.renameSync(tmpPath, filePath);

    let syncResult;
    try {
      syncResult = this.syncProviderRules(normalized);
    } catch (error) {
      atomicWrite(filePath, prevContent);
      throw error;
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      action,
      source,
      previousLength: prevContent.length,
      newLength: normalized.length
    };
    fs.appendFileSync(this.getAuditFilePath(), JSON.stringify(auditEntry) + '\n', 'utf-8');

    try {
      const db = getDb();
      const logId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO memory_logs (id, action, source, previous_content, new_content, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(logId, action, source, prevContent, normalized);
    } catch (err) {
      console.warn(`[MemoryManager] DB 로그 기록 경고: ${err.message}`);
    }

    return syncResult;
  }

  static appendEntry(entry) {
    const current = this.getMemoryContent().trim();
    const updated = `${current}\n- ${entry.trim()}`;
    return this.writeMemoryFile(updated, 'APPEND', 'USER');
  }

  static clearMemory() {
    const defaultTemplate = `# Agent Hub Global Memory\n\n`;
    return this.writeMemoryFile(defaultTemplate, 'CLEAR', 'USER');
  }

  static getMemoryForPrompt() {
    // V2에서는 Provider native Rules가 장기 기억을 공급한다.
    // 호환성을 위해 메서드는 남기되 prompt hot path에는 주입하지 않는다.
    return null;
  }
}

export { MEMORY_START, MEMORY_END, replaceManagedBlock };
