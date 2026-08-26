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
      // agy models는 독립 서브커맨드다. --skip-trust 같은 대화 실행용 플래그를 붙이지 않는다.
      const { stdout, stderr } = await execFileAsync('agy', ['models'], {
        timeout: 20000,
        cwd: this.workspaceDir,
        env: { ...process.env, CI: 'true' }
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

        // agy 버전에 따라 다음 두 형태를 모두 지원한다.
        // 1) gemini-3.6-flash-high
        // 2) gemini-3.6-flash-high<TAB>Gemini 3.6 Flash (High)
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
            // 구버전은 bare slug 한 줄만 반환할 수 있다.
            id = line;
            displayName = line;
          }
        }

        // 모델 slug/display name으로 보이는 항목만 허용한다.
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
