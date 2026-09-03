import crypto from 'node:crypto';
import { getDb } from '../database/index.js';

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    webhookUrl: row.webhook_url,
    description: row.description || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class DeployRepository {
  static create({ name, webhookUrl, description = '' }) {
    const cleanName = String(name || '').trim().toLowerCase();
    if (!cleanName) throw new Error('배포 타겟 이름이 필요합니다.');
    if (!/^[a-z0-9._-]+$/.test(cleanName)) {
      throw new Error('배포 타겟 이름은 영소문자, 숫자, 점, 대시, 밑줄만 사용할 수 있습니다.');
    }

    const cleanUrl = String(webhookUrl || '').trim();
    if (!cleanUrl) throw new Error('Coolify Webhook URL이 필요합니다.');
    try {
      const parsed = new URL(cleanUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('올바른 HTTP/HTTPS URL이어야 합니다.');
      }
    } catch {
      throw new Error('올바른 Webhook URL 형식이 아닙니다.');
    }

    const id = crypto.randomUUID();
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO deploy_targets (id, name, webhook_url, description)
      VALUES (?, ?, ?, ?)
    `);

    try {
      stmt.run(id, cleanName, cleanUrl, String(description || '').trim());
      return this.findByName(cleanName);
    } catch (err) {
      if (err.message?.includes('UNIQUE constraint failed')) {
        throw new Error(`이미 존재하는 배포 타겟입니다: '${cleanName}'`);
      }
      throw err;
    }
  }

  static findByName(name) {
    const cleanName = String(name || '').trim().toLowerCase();
    const row = getDb().prepare('SELECT * FROM deploy_targets WHERE name = ?').get(cleanName);
    return hydrate(row);
  }

  static findById(id) {
    const row = getDb().prepare('SELECT * FROM deploy_targets WHERE id = ?').get(id);
    return hydrate(row);
  }

  static list() {
    const rows = getDb().prepare('SELECT * FROM deploy_targets ORDER BY name ASC').all();
    return rows.map(hydrate);
  }

  static delete(name) {
    const cleanName = String(name || '').trim().toLowerCase();
    const res = getDb().prepare('DELETE FROM deploy_targets WHERE name = ?').run(cleanName);
    return res.changes > 0;
  }

  static async trigger(name) {
    const target = this.findByName(name);
    if (!target) {
      throw new Error(`등록되지 않은 배포 타겟입니다: '${name}'`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'AgentHub-Core/2.0'
      };
      const coolifyToken = process.env.COOLIFY_API_TOKEN;
      if (coolifyToken?.trim()) {
        headers['Authorization'] = `Bearer ${coolifyToken.trim()}`;
      }

      const res = await fetch(target.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'agent-hub-telegram',
          target: target.name,
          triggeredAt: new Date().toISOString()
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        let hint = '';
        if (res.status === 401) {
          hint = ' (인증 실패: Coolify API Token이 필요합니다. COOLIFY_API_TOKEN 환경변수를 확인해주세요)';
        }
        throw new Error(`배포 요청 실패 (HTTP ${res.status}${hint})${errorBody ? `: ${errorBody.slice(0, 200)}` : ''}`);
      }

      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        target
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Webhook 호출 시간 초과 (10초): ${target.name}`);
      }
      throw new Error(`Webhook 호출 실패: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const deployRepository = DeployRepository;
