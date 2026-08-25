import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProviderAdapter } from '../provider-adapter.js';

const execFileAsync = promisify(execFile);

export class AntigravityAdapter extends ProviderAdapter {
  constructor() {
    super('antigravity');
    this.workspaceDir = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');
    this.defaultTimeoutMs = parseInt(process.env.ANTIGRAVITY_TIMEOUT_MS || '120000', 10);
    this.cachedModels = null;
    this.lastModelCheck = 0;
  }

  /**
   * Antigravity CLI (agy) 설치 및 버전 확인
   */
  async checkHealth() {
    try {
      const { stdout } = await execFileAsync('agy', ['--version'], { timeout: 10000 });
      const version = stdout.trim();
      return { healthy: true, version };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Antigravity 인증 상태 점검 (OAuth 및 ~/.gemini 세션 기반)
   */
  async checkAuth() {
    const health = await this.checkHealth();
    if (!health.healthy) {
      return { authenticated: false, details: `CLI 실행 불가: ${health.error}` };
    }

    const geminiDir = path.join(os.homedir(), '.gemini');
    const hasAuthFiles = fs.existsSync(geminiDir) && fs.readdirSync(geminiDir).length > 0;

    if (hasAuthFiles) {
      return {
        authenticated: true,
        details: 'Antigravity Google 계정 세션 인증 정상 (~/.gemini)'
      };
    }

    return {
      authenticated: false,
      details: 'Antigravity Google 로그인 필요 (`agy` 실행 후 브라우저 로그인 진행)'
    };
  }

  /**
   * 지원 모델 목록 동적 조회 (agy models 기반)
   */
  async discoverModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) {
      return this.cachedModels;
    }

    try {
      const { stdout } = await execFileAsync('agy', ['models'], { timeout: 10000 });
      // ANSI escape 코드 제거 및 라인 분할
      const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
      const lines = cleanStdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const discovered = [];

      for (const line of lines) {
        // 헤더나 구분선 필터링
        if (
          line.startsWith('Model') ||
          line.startsWith('---') ||
          line.startsWith('===') ||
          line.startsWith('Available') ||
          line.toLowerCase().includes('usage:')
        ) {
          continue;
        }

        const parts = line.split(/\s+/);
        const id = parts[0];
        if (id && id.length > 2) {
          const desc = parts.slice(1).join(' ');
          discovered.push({
            id,
            name: desc ? `${id} (${desc})` : id,
            default: discovered.length === 0 // 첫 번째 모델을 기본으로
          });
        }
      }

      if (discovered.length > 0) {
        console.log(`[AntigravityAdapter] agy models 동적 발견: ${discovered.length}개 모델`);
        this.cachedModels = discovered;
        this.lastModelCheck = now;
        return this.cachedModels;
      }
    } catch (err) {
      console.warn(`[AntigravityAdapter] agy models 동적 조회 실패: ${err.message}`);
    }

    // CLI 실행 실패 시 기본 fallback
    return [
      { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', default: true },
      { id: 'gemini-3.6-pro', name: 'Gemini 3.6 Pro' },
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet' }
    ];
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
      dynamicModelDiscovery: 'SUPPORTED',
      multiImage: 'SUPPORTED',
      nativeCompact: 'UNSUPPORTED',
      usageMetrics: 'PARTIAL'
    };
  }

  /**
   * 프롬프트 실행 (agy 공식 플래그 매핑)
   */
  async executePrompt(options = {}) {
    const { prompt, model, cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;

    return new Promise((resolve, reject) => {
      // agy 1.1.20 공식 비대화형 플래그 매핑
      const args = [
        '--print', prompt,
        '--dangerously-skip-permissions'
      ];

      if (model && model !== 'default') {
        args.push('--model', model);
      }

      const child = spawn('agy', args, {
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
          reject(new Error(`Antigravity 실행 타임아웃 (${timeoutMs / 1000}초 초과)`));
        }
      }, timeoutMs);

      if (signal) {
        signal.addEventListener('abort', () => {
          if (!isFinished) {
            isFinished = true;
            clearTimeout(timer);
            child.kill('SIGKILL');
            reject(new Error('Antigravity 작업이 사용자에 의해 중단되었습니다.'));
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
        reject(new Error(`Antigravity 프로세스 시작 실패: ${err.message}`));
      });

      child.on('close', (code) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);

        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();

        if (code !== 0) {
          const errorMsg = trimmedStderr || trimmedStdout || `Exit code: ${code}`;
          reject(new Error(`Antigravity 실행 실패 (Exit code: ${code}):\n${errorMsg}`));
          return;
        }

        resolve({
          response: trimmedStdout || 'Antigravity로부터 빈 응답을 받았습니다.'
        });
      });
    });
  }
}
