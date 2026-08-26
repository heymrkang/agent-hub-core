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
    this.modelDiscoveryTimeoutMs = parseInt(process.env.ANTIGRAVITY_MODEL_DISCOVERY_TIMEOUT_MS || '60000', 10);
    this.cachedModels = null;
    this.lastModelCheck = 0;
  }

  async checkHealth() {
    try {
      const { stdout } = await execFileAsync('agy', ['--version'], { timeout: 10000 });
      return { healthy: true, version: stdout.trim() };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  async checkAuth() {
    const health = await this.checkHealth();
    if (!health.healthy) return { authenticated: false, state: 'CLI_UNAVAILABLE', details: `CLI 실행 불가: ${health.error}` };

    const geminiDir = path.join(os.homedir(), '.gemini');
    const hasCredentialState = fs.existsSync(geminiDir) && fs.readdirSync(geminiDir).length > 0;
    return hasCredentialState
      ? { authenticated: null, state: 'CREDENTIAL_PRESENT', details: 'Antigravity 인증 상태 파일 존재. 실제 유효성은 CLI 실행 결과로 검증됩니다.' }
      : { authenticated: false, state: 'LOGIN_REQUIRED', details: 'Antigravity Google 로그인 필요 (`agy` 대화형 실행)' };
  }

  async discoverModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) return this.cachedModels;

    try {
      // 수동 shell에서 정상 동작하는 `agy models`와 최대한 동일한 환경으로 실행한다.
      // CI=true는 일부 CLI에서 비대화형 동작을 바꾸거나 대기를 유발할 수 있어 model discovery에는 강제하지 않는다.
      const { stdout, stderr } = await execFileAsync('agy', ['models'], {
        timeout: this.modelDiscoveryTimeoutMs,
        cwd: this.workspaceDir,
        env: { ...process.env }
      });

      const raw = `${stdout || ''}\n${stderr || ''}`;
      const clean = raw.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
      const discovered = [];
      const seen = new Set();

      for (const originalLine of clean.split('\n')) {
        const line = originalLine.trim();
        if (!line) continue;
        if (
          line.startsWith('Model') ||
          line.startsWith('---') ||
          line.startsWith('===') ||
          line.startsWith('Available') ||
          line.toLowerCase().startsWith('usage:')
        ) continue;

        let id;
        let displayName;

        if (line.includes('\t')) {
          const [slug, ...labelParts] = line.split('\t');
          id = slug.trim();
          displayName = labelParts.join('\t').trim() || id;
        } else {
          const parts = line.split(/\s{2,}/);
          if (parts.length > 1) {
            id = parts[0].trim();
            displayName = parts.slice(1).join(' ').trim() || id;
          } else {
            id = line;
            displayName = line;
          }
        }

        if (!id || id.length < 3 || seen.has(id)) continue;
        const looksLikeModel = /gemini|claude|gpt|oss|model/i.test(`${id} ${displayName}`);
        if (!looksLikeModel) continue;

        seen.add(id);
        discovered.push({
          id,
          name: displayName,
          default: discovered.length === 0
        });
      }

      if (discovered.length === 0) {
        throw new Error(`agy models 출력에서 모델을 파싱하지 못했습니다. raw=${clean.trim().slice(0, 300) || '(empty)'}`);
      }

      this.cachedModels = discovered;
      this.lastModelCheck = now;
      console.log(`[AntigravityAdapter] agy models 동적 발견: ${discovered.length}개 모델`);
      return discovered;
    } catch (error) {
      this.cachedModels = null;

      const diagnostic = {
        command: 'agy models',
        timeoutMs: this.modelDiscoveryTimeoutMs,
        code: error?.code ?? null,
        exitCode: error?.code ?? null,
        signal: error?.signal ?? null,
        killed: error?.killed ?? false,
        cwd: this.workspaceDir,
        PATH: process.env.PATH || '(unset)',
        HOME: process.env.HOME || '(unset)',
        stdout: String(error?.stdout || '').trim().slice(0, 2000) || '(empty)',
        stderr: String(error?.stderr || '').trim().slice(0, 2000) || '(empty)',
        message: error?.message || String(error)
      };
      console.error('[AntigravityAdapter] agy models 진단:', diagnostic);

      throw new Error(`Antigravity 모델 동적 조회 실패 (하드코딩 fallback 없음): ${error.message}`);
    }
  }

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

  async executePrompt(options = {}) {
    const { prompt, model, nativeSessionRef, cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;

    return new Promise((resolve, reject) => {
      const args = ['--print', prompt, '--output-format', 'json', '--dangerously-skip-permissions', '--effort', 'medium'];
      if (model && model !== 'default') args.push('--model', model);
      if (nativeSessionRef) args.push('--conversation', nativeSessionRef);

      const child = spawn('agy', args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

      if (signal) signal.addEventListener('abort', () => {
        if (!isFinished) {
          isFinished = true;
          clearTimeout(timer);
          child.kill('SIGKILL');
          reject(new Error('Antigravity 작업이 사용자에 의해 중단되었습니다.'));
        }
      }, { once: true });

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
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
        const raw = stdout.trim();
        const diagnostic = stderr.trim();
        if (code !== 0) {
          reject(new Error(`Antigravity 실행 실패 (Exit code: ${code}):\n${diagnostic || raw || `Exit code: ${code}`}`));
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (parsed.status && parsed.status !== 'SUCCESS') throw new Error(parsed.error || `status=${parsed.status}`);
          resolve({
            response: parsed.response ?? parsed.result ?? '',
            nativeSessionRef: parsed.conversation_id ?? parsed.conversationId ?? parsed.session_id ?? parsed.sessionId ?? nativeSessionRef ?? null,
            usage: parsed.usage ?? null
          });
        } catch (error) {
          if (error instanceof SyntaxError) {
            resolve({ response: raw || 'Antigravity로부터 빈 응답을 받았습니다.', nativeSessionRef: nativeSessionRef ?? null });
            return;
          }
          reject(new Error(`Antigravity 응답 상태 오류: ${error.message}`));
        }
      });
    });
  }
}
