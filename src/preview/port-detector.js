import { setTimeout as delay } from 'node:timers/promises';

const URL_PORT_PATTERN = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\]|[a-z0-9.-]+):(\d{1,5})(?:\b|\/)/gi;

export class PreviewPortDetectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PreviewPortDetectionError';
    this.code = code;
  }
}

function validPort(value, label = 'port') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PreviewPortDetectionError('INVALID_PORT', `올바르지 않은 ${label}: ${value}`);
  }
  return port;
}

export function portsFromLogs(logs) {
  const clean = String(logs || '').replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');
  const ports = new Set();
  for (const match of clean.matchAll(URL_PORT_PATTERN)) {
    const port = Number(match[1]);
    if (port >= 1 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

export class PreviewPortDetector {
  constructor({ runtime, timeoutMs = 300_000, pollIntervalMs = 500 } = {}) {
    if (!runtime) throw new PreviewPortDetectionError('INVALID_RUNTIME', 'Preview Runtime이 필요합니다.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new PreviewPortDetectionError('INVALID_TIMEOUT', '감지 timeout은 1ms 이상이어야 합니다.');
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) throw new PreviewPortDetectionError('INVALID_INTERVAL', '감지 주기는 1ms 이상이어야 합니다.');
    this.runtime = runtime;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
  }

  async detect(containerId, { manualPort = null, signal = null } = {}) {
    const requestedPort = manualPort === null || manualPort === undefined ? null : validPort(manualPort, '수동 port');
    const deadline = Date.now() + this.timeoutMs;
    let lastSocketPorts = [];
    let lastLogPorts = [];
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new PreviewPortDetectionError('ABORTED', 'Preview port 감지가 취소됐습니다.');
      const state = await this.runtime.inspect(containerId);
      if (!state.running) {
        throw new PreviewPortDetectionError('PROCESS_EXITED', `dev server가 준비 전에 종료됐습니다. (exit ${state.exitCode ?? 'unknown'})`);
      }
      const logPorts = portsFromLogs(await this.runtime.logs(containerId, { tail: 300 }));
      lastLogPorts = logPorts;
      lastSocketPorts = await this.runtime.listeningPorts(containerId);
      if (requestedPort !== null) {
        if (lastSocketPorts.includes(requestedPort)) return requestedPort;
      } else if (logPorts.length) return logPorts.at(-1);
      if (requestedPort === null && lastSocketPorts.length === 1) return lastSocketPorts[0];
      await delay(Math.min(this.pollIntervalMs, Math.max(deadline - Date.now(), 0)), undefined, signal ? { signal } : undefined).catch((error) => {
        if (error?.name === 'AbortError') throw new PreviewPortDetectionError('ABORTED', 'Preview port 감지가 취소됐습니다.');
        throw error;
      });
    }
    if (requestedPort !== null) {
      throw new PreviewPortDetectionError('PORT_DETECTION_TIMEOUT', `수동 지정 port ${requestedPort}에서 listening socket을 확인하지 못했습니다.`);
    }
    const logDetail = lastLogPorts.length ? lastLogPorts.join(',') : 'none';
    const socketDetail = lastSocketPorts.length ? lastSocketPorts.join(',') : 'none';
    throw new PreviewPortDetectionError('PORT_DETECTION_TIMEOUT', `dev server port를 자동 감지하지 못했습니다. (log_ports=${logDetail}, listening_ports=${socketDetail}) 수동 port를 지정하세요.`);
  }
}
