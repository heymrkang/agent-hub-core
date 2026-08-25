import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from '../database/index.js';

export class MemoryManager {
  static getMemoryDir() {
    const dataDir = process.env.DATA_DIR || '/data';
    const memDir = path.join(dataDir, 'memory');
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    return memDir;
  }

  static getMemoryFilePath() {
    return path.join(this.getMemoryDir(), 'MEMORY.md');
  }

  static getAuditFilePath() {
    return path.join(this.getMemoryDir(), 'audit.jsonl');
  }

  /**
   * MEMORY.md 파일 내용을 읽어온다. 없으면 기본 템플릿을 생성한다.
   * @returns {string}
   */
  static getMemoryContent() {
    const filePath = this.getMemoryFilePath();
    if (!fs.existsSync(filePath)) {
      const defaultTemplate = `# Agent Hub Global Memory\n\n- 사용자 선호: 직설적인 디시 톤\n- 시스템 역할: Agent Hub 코어 어시스턴트\n`;
      this.writeMemoryFile(defaultTemplate, 'INIT');
      return defaultTemplate;
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * MEMORY.md 파일에 새 내용을 원자적으로 저장하고 감사 로그를 남긴다.
   * @param {string} newContent
   * @param {string} source 'USER' | 'AGENT' | 'SYSTEM'
   * @param {string} action 'UPDATE' | 'APPEND' | 'CLEAR' | 'INIT'
   */
  static writeMemoryFile(newContent, action = 'UPDATE', source = 'USER') {
    const memDir = this.getMemoryDir();
    const filePath = this.getMemoryFilePath();
    const prevContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';

    // 임시 파일에 먼저 쓰고 원자적 rename
    const tmpPath = path.join(memDir, `MEMORY.tmp.${Date.now()}`);
    fs.writeFileSync(tmpPath, newContent, 'utf-8');
    fs.renameSync(tmpPath, filePath);

    // 1. Audit Trail 파일에 기록 (JSONL)
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action,
      source,
      previousLength: prevContent.length,
      newLength: newContent.length
    };
    fs.appendFileSync(this.getAuditFilePath(), JSON.stringify(auditEntry) + '\n', 'utf-8');

    // 2. DB memory_logs 테이블에 기록
    try {
      const db = getDb();
      const logId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO memory_logs (id, action, source, previous_content, new_content, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(logId, action, source, prevContent, newContent);
    } catch (err) {
      console.warn(`[MemoryManager] DB 로그 기록 경고: ${err.message}`);
    }
  }

  /**
   * 단일 항목을 메모리 파일 끝에 추가한다.
   * @param {string} entry
   */
  static appendEntry(entry) {
    const current = this.getMemoryContent().trim();
    const updated = `${current}\n- ${entry.trim()}`;
    this.writeMemoryFile(updated, 'APPEND', 'USER');
  }

  /**
   * 메모리를 기본 상태로 초기화한다.
   */
  static clearMemory() {
    const defaultTemplate = `# Agent Hub Global Memory\n\n`;
    this.writeMemoryFile(defaultTemplate, 'CLEAR', 'USER');
  }

  /**
   * 프롬프트 주입용 요약 텍스트를 반환한다.
   * @returns {string|null}
   */
  static getMemoryForPrompt() {
    const content = this.getMemoryContent().trim();
    if (!content) return null;
    return `[글로벌 장기 기억 / Global Memory]\n${content}`;
  }
}
