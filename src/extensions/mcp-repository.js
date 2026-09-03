import crypto from 'node:crypto';
import { getDb } from '../database/index.js';

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command || null,
    args: parseJson(row.args_json, []),
    url: row.url || null,
    envKeys: parseJson(row.env_keys_json, []),
    headers: parseJson(row.headers_json, {}),
    enabled: Boolean(row.enabled),
    description: row.description || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class McpRepository {
  static create({
    name,
    transport = 'stdio',
    command = null,
    args = [],
    url = null,
    envKeys = [],
    headers = {},
    enabled = true,
    description = ''
  }) {
    const cleanName = String(name || '').trim().toLowerCase();
    if (!cleanName) throw new Error('MCP 서버 이름이 필요합니다.');
    if (!/^[a-z0-9._-]+$/.test(cleanName)) {
      throw new Error('MCP 서버 이름은 영소문자, 숫자, 점, 대시, 밑줄만 사용할 수 있습니다.');
    }
    const cleanTransport = String(transport || 'stdio').toLowerCase();
    if (!['stdio', 'http'].includes(cleanTransport)) {
      throw new Error("transport는 'stdio' 또는 'http'여야 합니다.");
    }
    if (cleanTransport === 'stdio' && !command) {
      throw new Error('stdio transport에는 실행 command가 필요합니다.');
    }
    if (cleanTransport === 'http' && !url) {
      throw new Error('http transport에는 url이 필요합니다.');
    }

    const id = crypto.randomUUID();
    const db = getDb();
    db.prepare(`
      INSERT INTO mcp_servers (
        id, name, transport, command, args_json, url, env_keys_json, headers_json, enabled, description, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
      )
    `).run(
      id,
      cleanName,
      cleanTransport,
      command ? String(command).trim() : null,
      JSON.stringify(Array.isArray(args) ? args : []),
      url ? String(url).trim() : null,
      JSON.stringify(Array.isArray(envKeys) ? envKeys : []),
      JSON.stringify(headers && typeof headers === 'object' ? headers : {}),
      enabled ? 1 : 0,
      description ? String(description).trim() : ''
    );
    return this.getById(id);
  }

  static getById(id) {
    const row = getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
    return hydrate(row);
  }

  static getByName(name) {
    const cleanName = String(name || '').trim().toLowerCase();
    const row = getDb().prepare('SELECT * FROM mcp_servers WHERE name = ?').get(cleanName);
    return hydrate(row);
  }

  static list({ enabledOnly = false } = {}) {
    const sql = enabledOnly
      ? 'SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY name ASC'
      : 'SELECT * FROM mcp_servers ORDER BY name ASC';
    const rows = getDb().prepare(sql).all();
    return rows.map(hydrate);
  }

  static update(id, values = {}) {
    const existing = this.getById(id);
    if (!existing) throw new Error(`MCP 서버를 찾을 수 없습니다: ${id}`);

    const updates = [];
    const params = [];

    if (values.name !== undefined) {
      const cleanName = String(values.name).trim().toLowerCase();
      if (!/^[a-z0-9._-]+$/.test(cleanName)) {
        throw new Error('MCP 서버 이름은 영소문자, 숫자, 점, 대시, 밑줄만 사용할 수 있습니다.');
      }
      updates.push('name = ?');
      params.push(cleanName);
    }
    if (values.transport !== undefined) {
      const cleanTransport = String(values.transport).toLowerCase();
      if (!['stdio', 'http'].includes(cleanTransport)) {
        throw new Error("transport는 'stdio' 또는 'http'여야 합니다.");
      }
      updates.push('transport = ?');
      params.push(cleanTransport);
    }
    if (values.command !== undefined) {
      updates.push('command = ?');
      params.push(values.command ? String(values.command).trim() : null);
    }
    if (values.args !== undefined) {
      updates.push('args_json = ?');
      params.push(JSON.stringify(Array.isArray(values.args) ? values.args : []));
    }
    if (values.url !== undefined) {
      updates.push('url = ?');
      params.push(values.url ? String(values.url).trim() : null);
    }
    if (values.envKeys !== undefined) {
      updates.push('env_keys_json = ?');
      params.push(JSON.stringify(Array.isArray(values.envKeys) ? values.envKeys : []));
    }
    if (values.headers !== undefined) {
      updates.push('headers_json = ?');
      params.push(JSON.stringify(values.headers && typeof values.headers === 'object' ? values.headers : {}));
    }
    if (values.enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(values.enabled ? 1 : 0);
    }
    if (values.description !== undefined) {
      updates.push('description = ?');
      params.push(String(values.description).trim());
    }

    if (!updates.length) return existing;

    updates.push("updated_at = datetime('now')");
    params.push(id);

    getDb().prepare(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  static toggle(id) {
    const existing = this.getById(id);
    if (!existing) throw new Error(`MCP 서버를 찾을 수 없습니다: ${id}`);
    const next = !existing.enabled;
    return this.update(id, { enabled: next });
  }

  static delete(id) {
    const existing = this.getById(id);
    if (!existing) return false;
    getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return true;
  }
}
