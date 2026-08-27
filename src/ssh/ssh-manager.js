import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDb } from '../database/index.js';
import { generateSshConfig, ensureSshLayout, SSH_KEYS_DIR } from './config-generator.js';

const execFileAsync = promisify(execFile);
const ALIAS_RE = /^[A-Za-z0-9._-]{1,48}$/;

function resolveIdentityFile(input) {
  const name = path.basename(String(input || '').trim());
  if (!name || name === '.' || name === '..') throw new Error('SSH Key 파일명을 입력해야 합니다.');
  const resolved = path.join(SSH_KEYS_DIR, name);
  if (!resolved.startsWith(`${SSH_KEYS_DIR}${path.sep}`)) throw new Error('허용되지 않은 SSH Key 경로입니다.');
  return resolved;
}

export class SshManager {
  static init() {
    ensureSshLayout();
    for (const key of this.listKeyFiles()) {
      try { fs.chmodSync(path.join(SSH_KEYS_DIR, key), 0o600); } catch (error) { console.warn(`[SSH] Key permission 보정 실패: ${key}: ${error.message}`); }
    }
    this.regenerateConfig();
    return this.getSummary();
  }

  static listKeyFiles() {
    ensureSshLayout();
    return fs.readdirSync(SSH_KEYS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !name.endsWith('.pub'))
      .sort((a, b) => a.localeCompare(b));
  }

  static listHosts(userId, { includeDisabled = true } = {}) {
    const sql = includeDisabled
      ? 'SELECT * FROM ssh_hosts WHERE user_id=? ORDER BY alias COLLATE NOCASE'
      : 'SELECT * FROM ssh_hosts WHERE user_id=? AND enabled=1 ORDER BY alias COLLATE NOCASE';
    return getDb().prepare(sql).all(userId);
  }

  static listAllEnabledHosts() {
    return getDb().prepare('SELECT * FROM ssh_hosts WHERE enabled=1 ORDER BY alias COLLATE NOCASE').all();
  }

  static getHost(userId, alias) {
    return getDb().prepare('SELECT * FROM ssh_hosts WHERE user_id=? AND alias=?').get(userId, alias) || null;
  }

  static addHost(userId, { alias, host, port = 22, username, identityFile }) {
    alias = String(alias || '').trim();
    host = String(host || '').trim();
    username = String(username || '').trim();
    port = Number(port || 22);
    if (!ALIAS_RE.test(alias)) throw new Error('Alias는 영문/숫자/._- 조합 1~48자만 가능합니다.');
    if (!host || /[\s\r\n]/.test(host)) throw new Error('올바른 Host를 입력해야 합니다.');
    if (!username || /[\s\r\n]/.test(username)) throw new Error('올바른 SSH User를 입력해야 합니다.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH Port는 1~65535 범위여야 합니다.');

    ensureSshLayout();
    const identityPath = resolveIdentityFile(identityFile);
    if (!fs.existsSync(identityPath)) throw new Error(`SSH Key가 없습니다: ${path.basename(identityPath)} — ${SSH_KEYS_DIR}에 직접 배치해주세요.`);
    fs.chmodSync(identityPath, 0o600);

    const id = crypto.randomUUID();
    getDb().prepare(`INSERT INTO ssh_hosts(id,user_id,alias,host,port,username,identity_file,enabled) VALUES(?,?,?,?,?,?,?,1)`)
      .run(id, userId, alias, host, port, username, identityPath);
    this.regenerateConfig();
    return this.getHost(userId, alias);
  }

  static updateHost(userId, alias, patch = {}) {
    const current = this.getHost(userId, alias);
    if (!current) throw new Error(`SSH Host를 찾을 수 없습니다: ${alias}`);
    const next = {
      host: String(patch.host ?? current.host).trim(),
      port: Number(patch.port ?? current.port),
      username: String(patch.username ?? current.username).trim(),
      identity_file: patch.identityFile ? resolveIdentityFile(patch.identityFile) : current.identity_file,
      enabled: patch.enabled === undefined ? current.enabled : (patch.enabled ? 1 : 0)
    };
    if (!next.host || /[\s\r\n]/.test(next.host)) throw new Error('올바른 Host를 입력해야 합니다.');
    if (!next.username || /[\s\r\n]/.test(next.username)) throw new Error('올바른 SSH User를 입력해야 합니다.');
    if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new Error('SSH Port는 1~65535 범위여야 합니다.');
    if (!fs.existsSync(next.identity_file)) throw new Error(`SSH Key가 없습니다: ${path.basename(next.identity_file)}`);
    fs.chmodSync(next.identity_file, 0o600);
    getDb().prepare(`UPDATE ssh_hosts SET host=?,port=?,username=?,identity_file=?,enabled=?,updated_at=datetime('now') WHERE user_id=? AND alias=?`)
      .run(next.host, next.port, next.username, next.identity_file, next.enabled, userId, alias);
    this.regenerateConfig();
    return this.getHost(userId, alias);
  }

  static setEnabled(userId, alias, enabled) {
    const r = getDb().prepare(`UPDATE ssh_hosts SET enabled=?,updated_at=datetime('now') WHERE user_id=? AND alias=?`).run(enabled ? 1 : 0, userId, alias);
    if (!r.changes) throw new Error(`SSH Host를 찾을 수 없습니다: ${alias}`);
    this.regenerateConfig();
  }

  static removeHost(userId, alias) {
    const host = this.getHost(userId, alias);
    if (!host) throw new Error(`SSH Host를 찾을 수 없습니다: ${alias}`);
    getDb().prepare('DELETE FROM ssh_hosts WHERE user_id=? AND alias=?').run(userId, alias);
    this.regenerateConfig();
    return { removed: true, keyPreserved: host.identity_file };
  }

  static regenerateConfig() {
    return generateSshConfig(this.listAllEnabledHosts());
  }

  static async testConnection(userId, alias, timeoutMs = 10000) {
    const host = this.getHost(userId, alias);
    if (!host) throw new Error(`SSH Host를 찾을 수 없습니다: ${alias}`);
    if (!host.enabled) throw new Error('비활성화된 SSH Host입니다.');
    try {
      const { stdout, stderr } = await execFileAsync('ssh', ['-o', `ConnectTimeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}`, alias, 'printf AGENT_HUB_SSH_OK'], { timeout: timeoutMs + 2000 });
      const output = `${stdout || ''}${stderr || ''}`;
      return { ok: output.includes('AGENT_HUB_SSH_OK'), message: output.trim().slice(0, 500) || 'SSH handshake 성공' };
    } catch (error) {
      const detail = String(error.stderr || error.stdout || error.message || '').replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED]').slice(0, 700);
      return { ok: false, message: detail };
    }
  }

  static getSummary() {
    ensureSshLayout();
    const row = getDb().prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS enabled FROM ssh_hosts').get();
    return { total: row?.total || 0, enabled: row?.enabled || 0, keys: this.listKeyFiles().length, keysDir: SSH_KEYS_DIR };
  }
}
