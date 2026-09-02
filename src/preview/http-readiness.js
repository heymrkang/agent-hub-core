import { setTimeout as delay } from 'node:timers/promises';

const RETRYABLE_PROBE_ERRORS = new Set(['ECONNREFUSED', 'ETIMEDOUT']);

export class PreviewHttpReadinessError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PreviewHttpReadinessError';
    this.code = code;
  }
}

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PreviewHttpReadinessError('INVALID_PORT', `올바르지 않은 readiness port: ${value}`);
  }
  return port;
}

function validPath(value) {
  const path = String(value || '/');
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) {
    throw new PreviewHttpReadinessError('INVALID_PATH', `올바르지 않은 readiness path: ${value}`);
  }
  return path;
}

export class PreviewHttpReadiness {
  constructor({ runtime, timeoutMs = 300_000, pollIntervalMs = 500, requestTimeoutMs = 2_000 } = {}) {
    if (!runtime) throw new PreviewHttpReadinessError('INVALID_RUNTIME', 'Preview Runtime이 필요합니다.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new PreviewHttpReadinessError('INVALID_TIMEOUT', 'readiness timeout은 1ms 이상이어야 합니다.');
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) throw new PreviewHttpReadinessError('INVALID_INTERVAL', 'readiness 주기는 1ms 이상이어야 합니다.');
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30_000) {
      throw new PreviewHttpReadinessError('INVALID_REQUEST_TIMEOUT', 'HTTP 요청 timeout은 1~30000ms 정수여야 합니다.');
    }
    this.runtime = runtime;
    this.timeoutMs = timeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async wait(containerId, { port, path = '/', signal = null } = {}) {
    const targetPort = validPort(port);
    const targetPath = validPath(path);
    const deadline = Date.now() + this.timeoutMs;
    let lastProbe = null;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new PreviewHttpReadinessError('ABORTED', 'HTTP readiness 확인이 취소됐습니다.');
      const state = await this.runtime.inspect(containerId);
      if (!state.running) {
        throw new PreviewHttpReadinessError('PROCESS_EXITED', `HTTP 준비 전에 dev server가 종료됐습니다. (exit ${state.exitCode ?? 'unknown'})`);
      }

      try {
        lastProbe = await this.runtime.probeHttp(containerId, {
          port: targetPort,
          path: targetPath,
          timeoutMs: Math.min(this.requestTimeoutMs, Math.max(deadline - Date.now(), 1))
        });
        if (lastProbe?.reachable && Number.isInteger(lastProbe.statusCode)) {
          return Object.freeze({
            port: targetPort,
            path: targetPath,
            statusCode: lastProbe.statusCode,
            contentType: lastProbe.contentType || null
          });
        }
        if (!RETRYABLE_PROBE_ERRORS.has(lastProbe?.errorCode)) {
          throw new PreviewHttpReadinessError(
            'HTTP_PROBE_FAILED',
            `HTTP readiness probe가 실패했습니다. (${lastProbe?.errorCode || 'UNKNOWN'}${lastProbe?.errorMessage ? `: ${lastProbe.errorMessage}` : ''})`
          );
        }
      } catch (error) {
        if (error instanceof PreviewHttpReadinessError) throw error;
        if (error?.code === 'INVALID_DOCKER_RESPONSE' || error?.code === 'INVALID_INPUT') throw error;
        if (!RETRYABLE_PROBE_ERRORS.has(error?.code)) {
          throw new PreviewHttpReadinessError('HTTP_PROBE_FAILED', `HTTP readiness probe 실행에 실패했습니다. (${error?.code || 'UNKNOWN'}: ${error?.message || String(error)})`, error);
        }
        lastProbe = { errorCode: error?.code || 'HTTP_PROBE_FAILED', errorMessage: error?.message || String(error) };
      }

      await delay(Math.min(this.pollIntervalMs, Math.max(deadline - Date.now(), 0)), undefined, signal ? { signal } : undefined).catch((error) => {
        if (error?.name === 'AbortError') throw new PreviewHttpReadinessError('ABORTED', 'HTTP readiness 확인이 취소됐습니다.');
        throw error;
      });
    }

    const detail = lastProbe?.errorCode || lastProbe?.errorMessage
      ? ` 마지막 오류: ${lastProbe.errorCode || 'HTTP_ERROR'}${lastProbe.errorMessage ? ` (${lastProbe.errorMessage})` : ''}.`
      : '';
    throw new PreviewHttpReadinessError(
      'HTTP_READINESS_TIMEOUT',
      `port ${targetPort}${targetPath}에서 제한 시간 내 HTTP 응답을 받지 못했습니다.${detail} 서버가 0.0.0.0에 bind됐는지 확인하세요.`
    );
  }
}
