import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PreviewRegistry, PreviewRegistryError, toPreviewSlug } from '../../src/preview/preview-registry.js';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const migrationDir = path.resolve('src/database/migrations');
  for (const filename of fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
  }
  db.prepare('INSERT INTO users(id) VALUES(1)').run();
  for (const id of ['session-1', 'session-2']) {
    db.prepare('INSERT INTO sessions(id,user_id,title) VALUES(?,?,?)').run(id, 1, id);
  }
  return db;
}

function fixedRandom(hexValues) {
  let index = 0;
  return () => Buffer.from(hexValues[index++] || 'ffff', 'hex');
}

test('slug와 public hostname을 만들고 Session/Workspace에 연결한다', () => {
  const db = createDb();
  try {
    const registry = new PreviewRegistry({ db, randomBytes: fixedRandom(['a31f']) });
    const preview = registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/workspace/My App', projectName: 'My Cool App!' });
    assert.equal(preview.slug, 'my-cool-app');
    assert.equal(preview.public_hostname, 'preview-my-cool-app-a31f.12190529.xyz');
    assert.equal(preview.public_url, 'https://preview-my-cool-app-a31f.12190529.xyz');
    assert.equal(preview.workspace_path, '/home/dev/workspace/My App');
    assert.equal(preview.status, 'STARTING');
    assert.equal(registry.getByHostname(preview.public_hostname).id, preview.id);
    assert.equal(registry.getByWorkspace(preview.workspace_path, { activeOnly: true }).id, preview.id);
  } finally { db.close(); }
});

test('비 ASCII 프로젝트명은 안전한 fallback slug를 사용한다', () => {
  assert.equal(toPreviewSlug('결혼식 청첩장'), 'preview');
});

test('동일 Workspace에는 활성 Preview를 하나만 허용한다', () => {
  const db = createDb();
  try {
    const registry = new PreviewRegistry({ db, randomBytes: fixedRandom(['0001', '0002']) });
    registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/workspace/app', projectName: 'app' });
    assert.throws(
      () => registry.create({ sessionId: 'session-2', workspacePath: '/home/dev/workspace/app/../app', projectName: 'app' }),
      (error) => error instanceof PreviewRegistryError && error.code === 'WORKSPACE_ACTIVE'
    );
  } finally { db.close(); }
});

test('동시 활성 Preview 제한을 원자적으로 적용한다', () => {
  const db = createDb();
  try {
    const registry = new PreviewRegistry({ db, maxActive: 2, randomBytes: fixedRandom(['0001', '0002', '0003']) });
    registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/a', projectName: 'a' });
    registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/b', projectName: 'b' });
    assert.equal(registry.countActive(), 2);
    assert.throws(
      () => registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/c', projectName: 'c' }),
      (error) => error.code === 'ACTIVE_LIMIT'
    );
  } finally { db.close(); }
});

test('동시 Preview 설정 변경을 다음 생성부터 반영한다', () => {
  const db = createDb();
  let limit = 2;
  try {
    const registry = new PreviewRegistry({ db, maxActive: () => limit, randomBytes: fixedRandom(['0001', '0002']) });
    registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/a', projectName: 'a' });
    limit = 1;
    assert.equal(registry.getMaxActive(), 1);
    assert.throws(
      () => registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/b', projectName: 'b' }),
      (error) => error.code === 'ACTIVE_LIMIT'
    );
  } finally { db.close(); }
});

test('상태 전이, runtime metadata, 종료 후 삭제를 관리한다', () => {
  const db = createDb();
  try {
    const registry = new PreviewRegistry({ db, randomBytes: fixedRandom(['1234']) });
    let preview = registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/app', projectName: 'app' });
    preview = registry.updateRuntime(preview.id, { containerId: 'container-1', command: 'npm run dev', packageManager: 'npm', port: 3000 });
    assert.equal(preview.port, 3000);
    preview = registry.updateStatus(preview.id, 'RUNNING');
    assert.ok(preview.started_at);
    assert.throws(() => registry.updateStatus(preview.id, 'STARTING'), (error) => error.code === 'INVALID_TRANSITION');
    assert.throws(() => registry.delete(preview.id), (error) => error.code === 'PREVIEW_ACTIVE');
    registry.updateStatus(preview.id, 'STOPPED');
    let restarted = registry.updateStatus(preview.id, 'STARTING');
    assert.equal(restarted.started_at, null);
    restarted = registry.updateStatus(preview.id, 'STOPPED');
    const deleted = registry.delete(preview.id);
    assert.equal(deleted.id, preview.id);
    assert.equal(registry.getById(preview.id), null);
  } finally { db.close(); }
});

test('없는 Session과 잘못된 port를 거부한다', () => {
  const db = createDb();
  try {
    const registry = new PreviewRegistry({ db, randomBytes: fixedRandom(['1234']) });
    assert.throws(
      () => registry.create({ sessionId: 'missing', workspacePath: '/home/dev/app', projectName: 'app' }),
      (error) => error.code === 'SESSION_NOT_FOUND'
    );
    const preview = registry.create({ sessionId: 'session-1', workspacePath: '/home/dev/app', projectName: 'app' });
    assert.throws(() => registry.updateRuntime(preview.id, { port: 70000 }), (error) => error.code === 'INVALID_PORT');
  } finally { db.close(); }
});
