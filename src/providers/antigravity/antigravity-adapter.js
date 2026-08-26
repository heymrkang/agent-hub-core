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
      const { stdout, stderr } = await execFileAsync(
        'script',
        ['-q', '-e', '-c', 'agy models', '/dev/null'],
        {
          timeout: this.modelDiscoveryTimeoutMs,
          cwd: this.workspaceDir,
          env: { ...process.env }
        }
      );

      const raw = `${stdout || ''}\n${stderr || ''}`;
      const clean = raw
        .replace(/\x1B\[[0-9;?]*[ -\/]*[@-~]/g, '')
        .replace(/\r/g, '\n');
      const discovered = [];
      const seen = new Set();

      for (const originalLine of clean.split('\n')) {
        let line = originalLine.trim();
        if (!line) continue;

        // PTY spinner/progress redraw는 CR 기반이라 여러 상태 문자열이 섞일 수 있다.
        // 모델 slug로 시작하는 실제 결과만 엄격하게 추출한다.
        if (/Fetching available models/i.test(line)) {
          const modelStart = line.search(/(?:gemini|claude|gpt|oss)[a-z0-9._-]*/i);
          if (modelStart < 0) continue;
          line = line.slice(modelStart).trim();
        }

        if (
          line.startsWith('Model') ||
          line.startsWith('---') ||
          line.startsWith('===') ||
          line.startsWith('Available') ||
          line.toLowerCase().startsWith('usage:')
        ) continue;

        const match = line.match(/^((?:gemini|claude|gpt|oss)[a-z0-9._-]*)(?:\s{2,}|\t)(.*)$/i)
          || line.match(/^((?:gemini|claude|gpt|oss)[a-z0-9._-]*)$/i);
        if (!match) continue;

        const id = match[1].trim();
        const displayName = (match[2] || id).trim();
        if (!id || seen.has(id)) continue;

        seen.add(id);
        discovered.push({
          id,
          name: displayName,
          default: discovered.length === 0
        });
      }

      if (discovered.length === 0) {
        throw new Error(`agy models 출력에서 모델을 파싱하지 못했습니다. raw=${clean.trim().slice(0, 500) || '(empty)'}`);
      }

      this.cachedModels = discovered;
      this.lastModelCheck = now;
      console.log(`[AntigravityAdapter] agy models PTY 동적 발견: ${discovered.length}개 모델`);
      return discovered;
    } catch (error) {
      this.cachedModels = null;

      const diagnostic = {
        command: 'script -q -e -c "agy models" /dev/null',
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
      console.error('[AntigravityAdapter] agy models PTY 진단:', diagnostic);

      throw new Error(`Antigravity 모델 동적 조회 실패 (PTY, 하드코딩 fallback 없음): ${error.message}`);
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
