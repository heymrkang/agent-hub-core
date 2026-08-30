import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewCleanup } from '../../src/preview/preview-cleanup.js';

function fixture({ previews, managed = [] }) {
  const rows = new Map(previews.map((preview) => [preview.id, { ...preview }]));
  const removed = [];
  const stopped = [];
  const logs = [];
  const registry = {
    list: () => [...rows.values()],
    getById: (id) => rows.get(id) || null,
    require: (id) => {
      const row = rows.get(id);
      if (!row) throw new Error('missing preview');
      return row;
    },
    updateStatus: (id, status, options = {}) => {
      const row = { ...rows.get(id), status, failure_reason: options.failureReason ?? null };
      rows.set(id, row);
      return row;
    }
  };
  const runtime = {
    listManaged: async () => managed.filter((item) => !removed.includes(item.id)).map((item) => item.id),
    inspect: async (id) => {
      const item = managed.find((entry) => entry.id === id);
      if (!item) throw Object.assign(new Error('missing container'), { code: 'NOT_FOUND' });
      return { id: item.id, labels: { 'agent-hub.managed': 'true', 'agent-hub.type': 'preview', 'agent-hub.preview-id': item.previewId } };
    },
    stop: async (id) => { stopped.push(id); },
    remove: async (id) => { removed.push(id); }
  };
  const manager = {
    reconcile: async (id) => {
      const row = rows.get(id);
      if (row.crashed) return registry.updateStatus(id, 'FAILED', { failureReason: 'exit 137' });
      return row;
    }
  };
  const cleanup = new PreviewCleanup({
    registry,
    runtime,
    manager,
    idleTimeoutHours: () => 24,
    logger: { error: (...args) => logs.push(args) }
  });
  return { cleanup, rows, removed, stopped, logs };
}

test('idle Preview는 EXPIRED 처리 후 container를 제거한다', async () => {
  const preview = { id: 'preview-1', status: 'RUNNING', container_id: 'container-1', last_activity_at: '2026-01-01 00:00:00' };
  const state = fixture({ previews: [preview], managed: [{ id: 'container-1', previewId: 'preview-1' }] });
  const summary = await state.cleanup.sweep({ now: new Date('2026-01-03T00:00:00Z') });
  assert.equal(state.rows.get('preview-1').status, 'EXPIRED');
  assert.deepEqual(state.stopped, ['container-1']);
  assert.deepEqual(state.removed, ['container-1']);
  assert.equal(summary.expired, 1);
});

test('수동 종료 설정은 idle Preview를 만료시키지 않는다', async () => {
  const state = fixture({ previews: [{ id: 'preview-1', status: 'RUNNING', container_id: 'container-1', last_activity_at: '2020-01-01 00:00:00' }] });
  state.cleanup.idleTimeoutHours = () => 0;
  const summary = await state.cleanup.sweep({ now: new Date('2026-01-03T00:00:00Z') });
  assert.equal(state.rows.get('preview-1').status, 'RUNNING');
  assert.equal(summary.expired, 0);
});

test('crash는 FAILED로 reconcile하고 container를 제거한다', async () => {
  const preview = { id: 'preview-1', status: 'RUNNING', container_id: 'container-1', last_activity_at: '2026-01-03 00:00:00', crashed: true };
  const state = fixture({ previews: [preview], managed: [{ id: 'container-1', previewId: 'preview-1' }] });
  const summary = await state.cleanup.sweep({ now: new Date('2026-01-03T01:00:00Z') });
  assert.equal(state.rows.get('preview-1').status, 'FAILED');
  assert.equal(summary.crashed, 1);
  assert.deepEqual(state.removed, ['container-1']);
});

test('registry에 없는 managed orphan만 제거한다', async () => {
  const active = { id: 'preview-1', status: 'RUNNING', container_id: 'container-1', last_activity_at: '2026-01-03 00:00:00' };
  const state = fixture({ previews: [active], managed: [{ id: 'container-1', previewId: 'preview-1' }, { id: 'orphan-1', previewId: 'missing' }] });
  const summary = await state.cleanup.cleanupOrphans();
  assert.deepEqual(state.removed, ['orphan-1']);
  assert.equal(summary.removed, 1);
});

test('Core 시작 시 실행 중인 활성 Preview를 유지한다', async () => {
  const preview = { id: 'preview-1', status: 'RUNNING', container_id: 'container-1', last_activity_at: '2026-01-03 00:00:00' };
  const state = fixture({ previews: [preview], managed: [{ id: 'container-1', previewId: 'preview-1' }] });
  const summary = await state.cleanup.startupReconcile();
  assert.equal(state.rows.get('preview-1').status, 'RUNNING');
  assert.equal(summary.recovered, 1);
  assert.deepEqual(state.removed, []);
});

test('Core 시작 시 죽은 활성 Preview는 FAILED 처리한다', async () => {
  const preview = { id: 'preview-1', status: 'RUNNING', container_id: 'container-1', last_activity_at: '2026-01-03 00:00:00', crashed: true };
  const state = fixture({ previews: [preview], managed: [{ id: 'container-1', previewId: 'preview-1' }] });
  const summary = await state.cleanup.startupReconcile();
  assert.equal(state.rows.get('preview-1').status, 'FAILED');
  assert.equal(summary.failed, 1);
  assert.deepEqual(state.removed, ['container-1']);
});
