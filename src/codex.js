import { spawn } from 'child_process';
import path from 'path';

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');
const CODEX_TIMEOUT_MS = parseInt(process.env.CODEX_TIMEOUT_MS || '120000', 10);

/**
 * Codex CLI를 비대화형(non-interactive)으로 실행하여 결과를 반환한다.
 * 프롬프트는 argv가 아니라 stdin으로 전달하여 공백/따옴표/한글 등으로 인한
 * 인자 파싱 문제를 피한다.
 * @param {string} prompt 사용자 입력 메시지
 * @returns {Promise<string>} Codex 응답 텍스트
 */
export async function executeCodex(prompt) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '-C',
      WORKSPACE_DIR,
      '-'
    ];

    const child = spawn('codex', args, {
      cwd: WORKSPACE_DIR,
      env: { ...process.env, CI: 'true' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let isFinished = false;

    const timer = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        child.kill('SIGKILL');
        reject(new Error(`Codex 실행 타임아웃 (${CODEX_TIMEOUT_MS / 1000}초 초과)`));
      }
    }, CODEX_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      reject(new Error(`Codex 프로세스 실행 실패: ${err.message}`));
    });

    child.on('close', (code) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);

      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();

      if (code !== 0) {
        const errorMsg = trimmedStderr || trimmedStdout || `Exit code: ${code}`;
        reject(new Error(`Codex 실행 실패 (Exit code: ${code}):\n${errorMsg}`));
        return;
      }

      resolve(trimmedStdout || 'Codex로부터 빈 응답을 받았습니다.');
    });

    // Codex exec의 stdin prompt 모드("-")에 사용자 메시지를 전달한다.
    child.stdin.on('error', (err) => {
      // 프로세스가 먼저 종료된 경우 발생할 수 있는 EPIPE는 close/error에서 처리한다.
      if (err.code !== 'EPIPE' && !isFinished) {
        isFinished = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new Error(`Codex 입력 전달 실패: ${err.message}`));
      }
    });

    child.stdin.end(prompt);
  });
}
