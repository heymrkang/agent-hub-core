import { redactSecrets } from '../../utils/redact.js';

const DEFAULT_TAIL_CHARS = 4000;
const DEFAULT_HEARTBEAT_MS = 60000;

export function appendDiagnosticTail(current, chunk, maxChars = DEFAULT_TAIL_CHARS) {
  const next = `${current || ''}${String(chunk ?? '')}`;
  return next.length <= maxChars ? next : next.slice(-maxChars);
}

export function sanitizeDiagnosticTail(value) {
  return redactSecrets(String(value ?? '').trim());
}

export function createCodexExecutionTelemetry({
  mode,
  pid = null,
  cwd,
  timeoutMs,
  now = () => Date.now(),
  heartbeatMs = Number(process.env.CODEX_EXEC_HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS),
  tailChars = Number(process.env.CODEX_DIAGNOSTIC_TAIL_CHARS || DEFAULT_TAIL_CHARS),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = console,
} = {}) {
  const startedAt = now();
  let lastOutputAt = startedAt;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTail = '';
  let stderrTail = '';
  let finished = false;

  const normalizedMode = String(mode || 'UNKNOWN');
  const safeCwd = sanitizeDiagnosticTail(cwd || 'unknown');
  const timeoutSec = Math.ceil(Number(timeoutMs || 0) / 1000);

  const snapshot = (reason, extra = {}) => ({
    reason,
    mode: normalizedMode,
    pid: pid ?? null,
    elapsedSec: Math.max(0, Math.floor((now() - startedAt) / 1000)),
    idleSec: Math.max(0, Math.floor((now() - lastOutputAt) / 1000)),
    stdoutBytes,
    stderrBytes,
    stdoutTail: sanitizeDiagnosticTail(stdoutTail),
    stderrTail: sanitizeDiagnosticTail(stderrTail),
    ...extra,
  });

  logger.log(`[CodexAdapter] exec 시작: mode=${normalizedMode} pid=${pid ?? 'unknown'} timeout=${timeoutSec}s cwd=${safeCwd}`);

  const heartbeat = setIntervalFn(() => {
    if (finished) return;
    const state = snapshot('heartbeat');
    logger.log(`[CodexAdapter] exec 진행: mode=${state.mode} pid=${state.pid ?? 'unknown'} elapsed=${state.elapsedSec}s idle=${state.idleSec}s stdout_bytes=${state.stdoutBytes} stderr_bytes=${state.stderrBytes}`);
  }, Math.max(10000, heartbeatMs));
  heartbeat?.unref?.();

  const record = (stream, chunk) => {
    const text = String(chunk ?? '');
    lastOutputAt = now();
    const bytes = Buffer.byteLength(text);
    if (stream === 'stderr') {
      stderrBytes += bytes;
      stderrTail = appendDiagnosticTail(stderrTail, text, tailChars);
    } else {
      stdoutBytes += bytes;
      stdoutTail = appendDiagnosticTail(stdoutTail, text, tailChars);
    }
  };

  const finish = (reason, extra = {}) => {
    if (finished) return snapshot(reason, extra);
    finished = true;
    clearIntervalFn(heartbeat);
    const state = snapshot(reason, extra);
    const line = `[CodexAdapter] exec 종료: mode=${state.mode} pid=${state.pid ?? 'unknown'} reason=${reason} elapsed=${state.elapsedSec}s idle=${state.idleSec}s stdout_bytes=${state.stdoutBytes} stderr_bytes=${state.stderrBytes}${state.exitCode !== undefined ? ` exit=${state.exitCode}` : ''}`;
    if (reason === 'completed') logger.log(line);
    else logger.warn(line);
    return state;
  };

  const timeout = () => {
    const state = finish('timeout');
    logger.error(`[CodexAdapter] exec TIMEOUT 진단: ${JSON.stringify(state)}`);
    return state;
  };

  return { recordStdout: (chunk) => record('stdout', chunk), recordStderr: (chunk) => record('stderr', chunk), snapshot, finish, timeout };
}

export const __codexTelemetryTestUtils = {
  DEFAULT_TAIL_CHARS,
  appendDiagnosticTail,
  sanitizeDiagnosticTail,
};
