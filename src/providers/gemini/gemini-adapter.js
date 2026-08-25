import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProviderAdapter } from '../provider-adapter.js';

const execFileAsync = promisify(execFile);

export class GeminiAdapter extends ProviderAdapter {
  constructor() {
    super('gemini');
    this.workspaceDir = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');
    this.defaultTimeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS || '120000', 10);
    this.cachedModels = null;
    this.lastModelCheck = 0;
  }

  /**
   * Gemini CLI 설치 및 버전 확인
   */
  async checkHealth() {
    try {
      const { stdout } = await execFileAsync('gemini', ['-v'], { timeout: 10000 });
      const version = stdout.trim();
      return { healthy: true, version };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Gemini 로그인/인증 상태 점검 (OAuth 세션 및 ~/.gemini 기반)
   */
  async checkAuth() {
    const health = await this.checkHealth();
    if (!health.healthy) {
      return { authenticated: false, details: `CLI 실행 불가: ${health.error}` };
    }

    // ~/.gemini 또는 /data/providers/gemini 세션 디렉토리 확인
    const userGeminiDir = path.join(os.homedir(), '.gemini');
    const dataGeminiDir = '/data/providers/gemini';

    const hasUserAuth = fs.existsSync(userGeminiDir) && fs.readdirSync(userGeminiDir).length > 0;
    const hasDataAuth = fs.existsSync(dataGeminiDir) && fs.readdirSync(dataGeminiDir).length > 0;

    // 간이 ping 프롬프트로 실제 OAuth 인증 세션 유효성 테스트
    try {
      await execFileAsync('gemini', ['-p', 'ping', '--approval-mode', 'yolo', '--skip-trust', '-o', 'text'], {
        timeout: 10000
      });
      return {
        authenticated: true,
        details: 'Gemini CLI 로그인 세션 인증 정상'
      };
    } catch (error) {
      // 에러 메시지에 auth 관련 키워드가 있는 경우
      if (error.message.includes('auth') || error.message.includes('login') || error.message.includes('credential')) {
        return {
          authenticated: false,
          details: 'Gemini CLI 로그인 필요 (`gemini login` 또는 ~/.gemini 영속 세션 필요)'
        };
      }

      if (hasUserAuth || hasDataAuth) {
        return {
          authenticated: true,
          details: 'Gemini 영속 세션 디렉토리 확인 완료'
        };
      }

      return {
        authenticated: false,
        details: 'Gemini CLI 로그인 필요 (영속 계정 미확인)'
      };
    }
  }

  /**
   * 지원 모델 목록 조회
   */
  async discoverModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) {
      return this.cachedModels;
    }

    this.cachedModels = [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (권장/빠름)', default: true },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (고성능)' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
    ];
    this.lastModelCheck = now;
    return this.cachedModels;
  }

  /**
   * 기능 지원 상태 반환
   */
  getCapabilities() {
    return {
      authPersistence: 'SUPPORTED',
      nonInteractive: 'SUPPORTED',
      jsonOutput: 'SUPPORTED',
      nativeSessionResume: 'SUPPORTED',
      modelSwitching: 'SUPPORTED',
      dynamicModelDiscovery: 'PARTIAL',
      multiImage: 'SUPPORTED',
      nativeCompact: 'UNSUPPORTED',
      usageMetrics: 'PARTIAL'
    };
  }

  /**
   * 프롬프트 실행
   */
  async executePrompt(options = {}) {
    const { prompt, model, cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;

    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--approval-mode', 'yolo',
        '--skip-trust',
        '-o', 'text'
      ];

      // 모델 지정
      if (model && model !== 'default') {
        args.push('-m', model);
      }

      const child = spawn('gemini', args, {
        cwd,
        env: { ...process.env, CI: 'true' },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let isFinished = false;

      const timer = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          child.kill('SIGKILL');
          reject(new Error(`Gemini 실행 타임아웃 (${timeoutMs / 1000}초 초과)`));
        }
      }, timeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          if (!isFinished) {
            isFinished = true;
            clearTimeout(timer);
            child.kill('SIGKILL');
            reject(new Error('Gemini 작업이 사용자에 의해 중단되었습니다.'));
          }
        });
      }

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
        reject(new Error(`Gemini 프로세스 시작 실패: ${err.message}`));
      });

      child.on('close', (code) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);

        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();

        if (code !== 0) {
          const errorMsg = trimmedStderr || trimmedStdout || `Exit code: ${code}`;
          reject(new Error(`Gemini 실행 실패 (Exit code: ${code}):\n${errorMsg}`));
          return;
        }

        resolve({
          response: trimmedStdout || 'Gemini로부터 빈 응답을 받았습니다.'
        });
      });
    });
  }
}
