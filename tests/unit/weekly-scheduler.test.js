import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRun, ScheduleType } from '../../src/scheduler/types.js';

test('WEEKLY: multi-day Korean schedule advances to next allowed weekday', () => {
  const from = new Date('2026-10-19T23:30:00.000Z'); // Tue 08:30 KST
  assert.equal(computeNextRun(ScheduleType.WEEKLY, '화,수,목,금 08:30', 'Asia/Seoul', from).toISOString(), '2026-10-20T23:30:00.000Z');
});
test('WEEKLY: Sunday schedule and range format', () => {
  assert.equal(computeNextRun(ScheduleType.WEEKLY, '일요일 22:00', 'Asia/Seoul', new Date('2026-10-20T00:00:00Z')).toISOString(), '2026-10-25T13:00:00.000Z');
  assert.equal(computeNextRun(ScheduleType.WEEKLY, '화~금 08:30', 'Asia/Seoul', new Date('2026-10-20T23:30:00Z')).toISOString(), '2026-10-21T23:30:00.000Z');
});
test('WEEKLY: rejects malformed weekday and hour formats', () => {
  assert.throws(() => computeNextRun('WEEKLY', '아무요일 22:00'), /요일/);
  assert.throws(() => computeNextRun('WEEKLY', '일요일 28:00'), /형식/);
});
