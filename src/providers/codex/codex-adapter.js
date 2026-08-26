import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { ProviderAdapter } from '../provider-adapter.js';

const execFileAsync = promisify(execFile);

export class CodexAdapter extends ProviderAdapter {
  constructor() {
    super('codex');
    this.workspaceDir = process.env.WORKSPACE_DIR || path.resolve(process.cwd(), 'workspace');
    this.defaultTimeoutMs = parseInt(process.env.CODEX_TIMEOUT_MS || '120000', 10);
    this.cachedModels = null;
    this.lastModelCheck = 0;
  }

  async checkHealth() {
    try {
      const { stdout } = await execFileAsync('codex', ['--version'], { timeout: 10000 });
      return { healthy: true, version: stdout.trim() };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkAuth() {
    const health = await this.checkHealth();
    if (!health.healthy) return { authenticated: false, state: 'CLI_UNAVAILABLE', details: `CLI 실행 불가: ${health.error}` };

    const codexDir = path.join(process.env.HOME || '/root', '.codex');
    const authFile = path.join(codexDir, 'auth.json');
    const hasCredential = fs.existsSync(authFile);

    return hasCredential
      ? { authenticated: null, state: 'CREDENTIAL_PRESENT', details: 'Codex 인증 파일 존재. 실제 인증 유효성은 첫 실행 결과로 검증됩니다.' }
      : { authenticated: false, state: 'LOGIN_REQUIRED', details: 'Codex 로그인 필요 (컨테이너 내 `codex login`)' };
  }

  async discoverModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) return this.cachedModels;

    try {
      const { stdout } = await execFileAsync('codex', ['doctor', '--json'], { timeout: 15000 });
      const report = JSON.parse(stdout);
      const discovered = Array.isArray(report.models)
        ? report.models.filter(Boolean).map((m) => ({
            id: typeof m === 'string' ? m : m.id,
            name: typeof m === 'string' ? m : m.name || m.id,
            default: Boolean(typeof m === 'object' && m.default)
          })).filter((m) => m.id)
        : [];
      if (discovered.length > 0) {
        this.cachedModels = discovered;
        this.lastModelCheck = now;
        return discovered;
      }
    } catch (error) {
      console.warn(`[CodexAdapter] 동적 모델 조회 불가: ${error.message}`);
    }

    // 하드코딩된 모델 이름을 절대 반환하지 않는다. CLI default 슬롯만 제공한다.
    this.cachedModels = [{ id: 'default', name: 'Codex 기본 모델 (CLI Default)', default: true }];
    this.lastModelCheck = now;
    return this.cachedModels;
  }

  getCapabilities() {
    return {
      authPersistence: 'SUPPORTED',
      nonInteractive: 'SUPPORTED',
      jsonOutput: 'SUPPORTED',
      nativeSessionResume: 'PARTIAL',
      modelSwitching: 'SUPPORTED',
      dynamicModelDiscovery: 'PARTIAL',
      multiImage: 'SUPPORTED',
      nativeCompact: 'UNSUPPORTED',
      usageMetrics: 'PARTIAL'
    };
  }

  async executePrompt(options = {}) {
    const { prompt, model, cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;

    return new Promise((resolve, reject) => {
      const args = ['exec'];
      if (model && model !== 'default') args.push('-m', model);
      args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', prompt);

      const child = spawn('codex', args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let isFinished = false;

      const finishError = (error) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        reject(error);
      };

      const timer = setTimeout(() => {
        if (!isFinished) {
          child.kill('SIGKILL');
          finishError(new Error(`Codex 실행 타임아웃 (${timeoutMs / 1000}초 초과)`));
        }
      }, timeoutMs);

      if (signal) signal.addEventListener('abort', () => {
        if (!isFinished) {
          child.kill('SIGKILL');
          finishError(new Error('Codex 작업이 사용자에 의해 중단되었습니다.'));
        }
      }, { once: true });

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => finishError(new Error(`Codex 프로세스 시작 실패: ${err.message}`)));
      child.on('close', (code) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        const response = stdout.trim();
        const diagnostic = stderr.trim();
        if (code !== 0) {
          reject(new Error(`Codex 실행 실패 (Exit code: ${code}):\n${diagnostic || response || `Exit code: ${code}`}`));
          return;
        }
        resolve({ response: response || 'Codex로부터 빈 응답을 받았습니다.' });
      });
    });
  }
}
