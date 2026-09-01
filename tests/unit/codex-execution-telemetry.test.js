import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendDiagnosticTail,
  sanitizeDiagnosticTail,
  createCodexExecutionTelemetry,
} from '../../src/providers/codex/execution-telemetry.js';

test('diagnostic tail keeps only the newest characters', () => {
  assert.equal(appendDiagnosticTail('abcdef', 'ghij', 6), 'efghij');
});

test('diagnostic tail redacts secrets before logging', () => {
  const value = 'request token=super-secret-value-that-should-never-leak';
  const sanitized = sanitizeDiagnosticTail(value);
  assert.doesNotMatch(sanitized, /super-secret-value-that-should-never-leak/);
  assert.match(sanitized, /\[REDACTED\]/);
});

test('telemetry tracks activity, bytes, timeout tail, and clears heartbeat', () => {
  let now = 1_000;
  let intervalCallback = null;
  let cleared = false;
  const logs = [];
  const logger = {
    log: (line) => logs.push(['log', line]),
    warn: (line) => logs.push(['warn', line]),
    error: (line) => logs.push(['error', line]),
  };
  const fakeInterval = { unref() {} };

  const telemetry = createCodexExecutionTelemetry({
    mode: 'FULL_ACCESS',
    pid: 123,
    cwd: '/home/dev',
    timeoutMs: 900_000,
    now: () => now,
    heartbeatMs: 10_000,
    tailChars: 40,
    setIntervalFn: (fn) => { intervalCallback = fn; return fakeInterval; },
    clearIntervalFn: (value) => { if (value === fakeInterval) cleared = true; },
    logger,
  });

  now += 5_000;
  telemetry.recordStdout('hello');
  telemetry.recordStderr('token=very-secret-value-that-must-be-redacted');
  now += 15_000;
  intervalCallback();
  const snapshot = telemetry.timeout();

  assert.equal(snapshot.reason, 'timeout');
  assert.equal(snapshot.elapsedSec, 20);
  assert.equal(snapshot.idleSec, 15);
  assert.equal(snapshot.stdoutBytes, 5);
  assert.ok(snapshot.stderrBytes > 0);
  assert.doesNotMatch(snapshot.stderrTail, /very-secret-value-that-must-be-redacted/);
  assert.equal(cleared, true);
  assert.ok(logs.some(([, line]) => line.includes('exec 시작')));
  assert.ok(logs.some(([, line]) => line.includes('exec 진행')));
  assert.ok(logs.some(([level, line]) => level === 'error' && line.includes('TIMEOUT 진단')));
});
