import crypto from 'node:crypto';
import path from 'node:path';
import { getDb } from '../database/index.js';

export const PreviewStatus = Object.freeze({
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED'
});

export const ACTIVE_PREVIEW_STATUSES = Object.freeze([
  PreviewStatus.STARTING,
  PreviewStatus.RUNNING,
  PreviewStatus.STOPPING
]);

const STATUS_TRANSITIONS = Object.freeze({
  STARTING: new Set(['RUNNING', 'STOPPING', 'STOPPED', 'FAILED', 'EXPIRED']),
  RUNNING: new Set(['STOPPING', 'STOPPED', 'FAILED', 'EXPIRED']),
  STOPPING: new Set(['STOPPED', 'FAILED']),
  STOPPED: new Set(['STARTING']),
  FAILED: new Set(['STARTING', 'STOPPED']),
  EXPIRED: new Set(['STARTING', 'STOPPED'])
});

const DEFAULT_DOMAIN = '12190529.xyz';
const DEFAULT_MAX_ACTIVE = 3;
const MAX_SLUG_LENGTH = 40;

export class PreviewRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PreviewRegistryError';
    this.code = code;
  }
}

export function toPreviewSlug(value) {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'preview';
}

function normalizeDomain(value) {
  const domain = String(value || DEFAULT_DOMAIN).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new PreviewRegistryError('INVALID_DOMAIN', `올바르지 않은 Preview domain: ${value}`);
  }
  return domain;
}

function normalizeWorkspacePath(value) {
  if (!value || !path.isAbsolute(value)) {
    throw new PreviewRegistryError('INVALID_WORKSPACE', 'Workspace 경로는 절대 경로여야 합니다.');
  }
  return path.resolve(value);
}

export class PreviewRegistry {
  constructor({ db = null, domain = process.env.PREVIEW_DOMAIN || DEFAULT_DOMAIN, maxActive = DEFAULT_MAX_ACTIVE, randomBytes = crypto.randomBytes } = {}) {
    this.db = db || getDb();
    this.domain = normalizeDomain(domain);
    this.maxActive = maxActive;
    this.randomBytes = randomBytes;
    if (typeof this.maxActive !== 'function' && (!Number.isInteger(Number(this.maxActive)) || Number(this.maxActive) < 1)) {
      throw new PreviewRegistryError('INVALID_LIMIT', '최대 동시 Preview 수는 1 이상의 정수여야 합니다.');
    }
  }

  getMaxActive() {
    const value = Number(typeof this.maxActive === 'function' ? this.maxActive() : this.maxActive);
    if (!Number.isInteger(value) || value < 1) throw new PreviewRegistryError('INVALID_LIMIT', '최대 동시 Preview 수는 1 이상의 정수여야 합니다.');
    return value;
  }

  create({ sessionId, workspacePath, projectName }) {
    if (!sessionId) throw new PreviewRegistryError('INVALID_SESSION', 'Session ID가 필요합니다.');
    const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
    const normalizedProject = String(projectName || path.basename(normalizedWorkspace)).trim();
    if (!normalizedProject) throw new PreviewRegistryError('INVALID_PROJECT', '프로젝트 이름이 필요합니다.');
    const slug = toPreviewSlug(normalizedProject);

    const insert = this.db.transaction(() => {
      const session = this.db.prepare('SELECT id FROM sessions WHERE id=?').get(sessionId);
      if (!session) throw new PreviewRegistryError('SESSION_NOT_FOUND', `Session을 찾을 수 없습니다: ${sessionId}`);

      const duplicate = this.getByWorkspace(normalizedWorkspace, { activeOnly: true });
      if (duplicate) {
        throw new PreviewRegistryError('WORKSPACE_ACTIVE', `이 Workspace에는 이미 활성 Preview가 있습니다: ${duplicate.id}`);
      }
      const maxActive = this.getMaxActive();
      if (this.countActive() >= maxActive) {
        throw new PreviewRegistryError('ACTIVE_LIMIT', `동시 Preview 제한(${maxActive}개)에 도달했습니다.`);
      }

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const suffix = this.randomBytes(2).toString('hex');
        const hostname = `preview-${slug}-${suffix}.${this.domain}`;
        const preview = {
          id: crypto.randomUUID(),
          sessionId,
          workspacePath: normalizedWorkspace,
          projectName: normalizedProject,
          slug,
          hostname,
          url: `https://${hostname}`
        };
        try {
          this.db.prepare(`
            INSERT INTO previews(id,session_id,workspace_path,project_name,slug,public_hostname,public_url,status)
            VALUES(@id,@sessionId,@workspacePath,@projectName,@slug,@hostname,@url,'STARTING')
          `).run(preview);
          return this.getById(preview.id);
        } catch (error) {
          if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE' || !String(error.message).includes('public_')) throw error;
        }
      }
      throw new PreviewRegistryError('HOSTNAME_COLLISION', '고유 Preview hostname 생성에 실패했습니다.');
    });

    return insert.immediate();
  }

  getById(id) {
    return this.db.prepare('SELECT * FROM previews WHERE id=?').get(id) || null;
  }

  getByHostname(hostname) {
    return this.db.prepare('SELECT * FROM previews WHERE public_hostname=?').get(String(hostname || '').toLowerCase()) || null;
  }

  getByWorkspace(workspacePath, { activeOnly = false } = {}) {
    const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
    const activeClause = activeOnly ? "AND status IN ('STARTING','RUNNING','STOPPING')" : '';
    return this.db.prepare(`SELECT * FROM previews WHERE workspace_path=? ${activeClause} ORDER BY created_at DESC LIMIT 1`).get(normalizedWorkspace) || null;
  }

  list({ sessionId = null, status = null, limit = 100 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const clauses = [];
    const params = [];
    if (sessionId) { clauses.push('session_id=?'); params.push(sessionId); }
    if (status) {
      if (!Object.hasOwn(PreviewStatus, status)) throw new PreviewRegistryError('INVALID_STATUS', `올바르지 않은 Preview 상태: ${status}`);
      clauses.push('status=?'); params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`SELECT * FROM previews ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, safeLimit);
  }

  countActive() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM previews WHERE status IN ('STARTING','RUNNING','STOPPING')").get().count;
  }

  updateRuntime(id, { containerId, command, packageManager, port } = {}) {
    const current = this.require(id);
    const nextPort = port === undefined ? current.port : port;
    if (nextPort !== null && (!Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535)) {
      throw new PreviewRegistryError('INVALID_PORT', `올바르지 않은 Preview port: ${nextPort}`);
    }
    this.db.prepare(`UPDATE previews SET container_id=?,command=?,package_manager=?,port=?,updated_at=datetime('now') WHERE id=?`)
      .run(containerId === undefined ? current.container_id : containerId, command ?? current.command, packageManager ?? current.package_manager, nextPort, id);
    return this.getById(id);
  }

  updateStatus(id, nextStatus, { failureReason = null } = {}) {
    const current = this.require(id);
    if (!Object.hasOwn(PreviewStatus, nextStatus)) {
      throw new PreviewRegistryError('INVALID_STATUS', `올바르지 않은 Preview 상태: ${nextStatus}`);
    }
    if (current.status !== nextStatus && !STATUS_TRANSITIONS[current.status]?.has(nextStatus)) {
      throw new PreviewRegistryError('INVALID_TRANSITION', `${current.status}에서 ${nextStatus}(으)로 전환할 수 없습니다.`);
    }
    const startedAt = nextStatus === PreviewStatus.STARTING
      ? 'NULL'
      : nextStatus === PreviewStatus.RUNNING ? "COALESCE(started_at, datetime('now'))" : 'started_at';
    const stoppedAt = ['STOPPED', 'FAILED', 'EXPIRED'].includes(nextStatus) ? "datetime('now')" : 'NULL';
    this.db.prepare(`UPDATE previews SET status=?,failure_reason=?,started_at=${startedAt},stopped_at=${stoppedAt},updated_at=datetime('now') WHERE id=?`)
      .run(nextStatus, nextStatus === PreviewStatus.FAILED ? failureReason : null, id);
    return this.getById(id);
  }

  touchActivity(id) {
    const result = this.db.prepare("UPDATE previews SET last_activity_at=datetime('now'),updated_at=datetime('now') WHERE id=?").run(id);
    if (!result.changes) throw new PreviewRegistryError('NOT_FOUND', `Preview를 찾을 수 없습니다: ${id}`);
    return this.getById(id);
  }

  delete(id) {
    const current = this.require(id);
    if (ACTIVE_PREVIEW_STATUSES.includes(current.status)) {
      throw new PreviewRegistryError('PREVIEW_ACTIVE', '활성 Preview는 정지한 뒤 삭제해야 합니다.');
    }
    this.db.prepare('DELETE FROM previews WHERE id=?').run(id);
    return current;
  }

  require(id) {
    const preview = this.getById(id);
    if (!preview) throw new PreviewRegistryError('NOT_FOUND', `Preview를 찾을 수 없습니다: ${id}`);
    return preview;
  }
}
