import { redactSecrets } from '../utils/redact.js';

const ANSI_PATTERN = /\u001b\[[0-?]*[ -\/]*[@-~]/g;

function clean(value) {
  return redactSecrets(String(value ?? '').replace(ANSI_PATTERN, '')).trim();
}

function commandText(command) {
  if (Array.isArray(command)) return command.map((part) => JSON.stringify(String(part))).join(' ');
  if (command?.executable && Array.isArray(command.args)) {
    return [command.executable, ...command.args].map((part) => JSON.stringify(String(part))).join(' ');
  }
  return String(command || 'unknown');
}

function hintFor(error, stage) {
  if (error?.code === 'PROCESS_EXITED') return 'package script, dependency 설치 오류와 애플리케이션 bootstrap 예외를 확인하세요.';
  if (error?.code === 'PORT_DETECTION_TIMEOUT') return '실제 listen port를 확인하고 필요하면 --port로 지정하세요.';
  if (error?.code === 'HTTP_READINESS_TIMEOUT' || stage === 'http_readiness') {
    return '서버를 0.0.0.0에 bind하고 감지된 port에서 HTTP 요청을 받는지 확인하세요.';
  }
  if (stage === 'container_create') return 'Docker image, lockfile, workspace mount와 package manager 설정을 확인하세요.';
  if (stage === 'container_start') return '컨테이너 시작 오류와 package install 로그를 확인하세요.';
  return '아래 로그의 첫 오류와 실행 명령을 확인하세요.';
}

export function createPreviewFailureDiagnostic({ error, stage, command, state = null, logs = '' } = {}) {
  const message = clean(error?.message || error || '알 수 없는 오류');
  const safeCommand = clean(commandText(command));
  const safeLogs = clean(logs).split('\n').slice(-40).join('\n').slice(-1_200);
  const processState = state
    ? (state.running ? 'running' : `exited (${state.exitCode ?? 'unknown'})`)
    : 'unknown';
  const lines = [
    `[${error?.code || 'PREVIEW_START_FAILED'}] ${message}`,
    `단계: ${clean(stage || 'unknown')}`,
    `명령: ${safeCommand || 'unknown'}`,
    `프로세스: ${processState}`,
    `조치: ${hintFor(error, stage)}`
  ];
  if (safeLogs) lines.push(`로그:\n${safeLogs}`);
  return clean(lines.join('\n')).slice(0, 2_000);
}
