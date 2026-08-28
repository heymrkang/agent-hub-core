import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
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
    this.restrictedRuntime = null;
  }

  async checkHealth() {
    try { const { stdout } = await execFileAsync('agy', ['--version'], { timeout: 10000 }); return { healthy: true, version: stdout.trim() }; }
    catch (error) { return { healthy: false, error: error.message }; }
  }

  async checkAuth() {
    const health = await this.checkHealth();
    if (!health.healthy) return { authenticated: false, state: 'CLI_UNAVAILABLE', details: `CLI 실행 불가: ${health.error}` };
    const geminiDir = path.join(os.homedir(), '.gemini');
    const hasCredentialState = fs.existsSync(geminiDir) && fs.readdirSync(geminiDir).length > 0;
    return hasCredentialState ? { authenticated: null, state: 'CREDENTIAL_PRESENT', details: 'Antigravity 인증 상태 파일 존재. 실제 유효성은 CLI 실행 결과로 검증됩니다.' } : { authenticated: false, state: 'LOGIN_REQUIRED', details: 'Antigravity Google 로그인 필요 (`agy` 대화형 실행)' };
  }

  async discoverModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) return this.cachedModels;
    try {
      const { stdout, stderr } = await execFileAsync('script', ['-q', '-e', '-c', 'agy models', '/dev/null'], { timeout: this.modelDiscoveryTimeoutMs, cwd: this.workspaceDir, env: { ...process.env } });
      const raw = `${stdout || ''}\n${stderr || ''}`;
      const clean = raw.replace(/\x1B\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r/g, '\n');
      const discovered = []; const seen = new Set();
      for (const originalLine of clean.split('\n')) {
        let line = originalLine.trim(); if (!line) continue;
        if (/Fetching available models/i.test(line)) { const modelStart = line.search(/(?:gemini|claude|gpt|oss)[a-z0-9._-]*/i); if (modelStart < 0) continue; line = line.slice(modelStart).trim(); }
        if (line.startsWith('Model') || line.startsWith('---') || line.startsWith('===') || line.startsWith('Available') || line.toLowerCase().startsWith('usage:')) continue;
        const match = line.match(/^((?:gemini|claude|gpt|oss)[a-z0-9._-]*)(?:\s{2,}|\t)(.*)$/i) || line.match(/^((?:gemini|claude|gpt|oss)[a-z0-9._-]*)$/i);
        if (!match) continue;
        const id = match[1].trim(); const displayName = (match[2] || id).trim(); if (!id || seen.has(id)) continue;
        seen.add(id); discovered.push({ id, name: displayName, default: discovered.length === 0 });
      }
      if (discovered.length === 0) throw new Error(`agy models 출력에서 모델을 파싱하지 못했습니다. raw=${clean.trim().slice(0, 500) || '(empty)'}`);
      this.cachedModels = discovered; this.lastModelCheck = now; console.log(`[AntigravityAdapter] agy models PTY 동적 발견: ${discovered.length}개 모델`); return discovered;
    } catch (error) {
      this.cachedModels = null;
      const diagnostic = { command: 'script -q -e -c "agy models" /dev/null', timeoutMs: this.modelDiscoveryTimeoutMs, code: error?.code ?? null, exitCode: error?.code ?? null, signal: error?.signal ?? null, killed: error?.killed ?? false, cwd: this.workspaceDir, PATH: process.env.PATH || '(unset)', HOME: process.env.HOME || '(unset)', stdout: String(error?.stdout || '').trim().slice(0, 2000) || '(empty)', stderr: String(error?.stderr || '').trim().slice(0, 2000) || '(empty)', message: error?.message || String(error) };
      console.error('[AntigravityAdapter] agy models PTY 진단:', diagnostic);
      throw new Error(`Antigravity 모델 동적 조회 실패 (PTY, 하드코딩 fallback 없음): ${error.message}`);
    }
  }

  getCapabilities() {
    return { authPersistence: 'SUPPORTED', nonInteractive: 'SUPPORTED', jsonOutput: 'SUPPORTED', nativeSessionResume: 'SUPPORTED', modelSwitching: 'SUPPORTED', dynamicModelDiscovery: 'SUPPORTED', multiImage: 'SUPPORTED', nativeCompact: 'UNSUPPORTED', usageMetrics: 'PARTIAL', executionProfiles: 'SUPPORTED' };
  }

  async getRestrictedRuntime() {
    if (this.restrictedRuntime) return this.restrictedRuntime;
    const self = process.env.HOSTNAME;
    if (!self) throw new Error('Restricted Antigravity 실행을 위한 현재 컨테이너 ID(HOSTNAME)를 확인할 수 없습니다.');

    try {
      const [{ stdout: imageOut }, { stdout: mountsOut }] = await Promise.all([
        execFileAsync('docker', ['inspect', self, '--format', '{{.Config.Image}}'], { timeout: 10000 }),
        execFileAsync('docker', ['inspect', self, '--format', '{{json .Mounts}}'], { timeout: 10000 })
      ]);
      const image = imageOut.trim();
      const mounts = JSON.parse(mountsOut.trim());
      const findMount = (destination) => mounts.find((m) => m.Destination === destination);
      const workspace = findMount('/workspace');
      const geminiHome = findMount('/root/.gemini');
      const data = findMount('/data');
      if (!image) throw new Error('현재 Agent Hub 이미지 이름을 찾지 못했습니다.');
      if (!workspace?.Source) throw new Error('/workspace host mount source를 찾지 못했습니다.');
      if (!geminiHome?.Source) throw new Error('/root/.gemini host mount source를 찾지 못했습니다.');

      this.restrictedRuntime = {
        image,
        workspaceSource: workspace.Source,
        geminiHomeSource: geminiHome.Source,
        uploadsSource: data?.Source ? path.join(data.Source, 'uploads') : null
      };
      console.log(`[AntigravityAdapter] Restricted profile runtime 준비 완료: image=${image}`);
      return this.restrictedRuntime;
    } catch (error) {
      throw new Error(`Restricted Antigravity 실행 환경 확인 실패: ${error.stderr || error.message}`);
    }
  }

  async removeHelperContainer(name) {
    try { await execFileAsync('docker', ['rm', '-f', name], { timeout: 10000 }); } catch {}
  }

  parseExecutionResult(raw, nativeSessionRef) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.status && parsed.status !== 'SUCCESS') throw new Error(parsed.error || `status=${parsed.status}`);
      return {
        response: parsed.response ?? parsed.result ?? '',
        nativeSessionRef: parsed.conversation_id ?? parsed.conversationId ?? parsed.session_id ?? parsed.sessionId ?? nativeSessionRef ?? null,
        usage: parsed.usage ?? null
      };
    } catch (error) {
      if (error instanceof SyntaxError) return { response: raw || 'Antigravity로부터 빈 응답을 받았습니다.', nativeSessionRef: nativeSessionRef ?? null };
      throw new Error(`Antigravity 응답 상태 오류: ${error.message}`);
    }
  }

  async executeRestrictedPrompt({ prompt, model, nativeSessionRef, profile, cwd, timeoutMs, signal }) {
    const runtime = await this.getRestrictedRuntime();
    const normalizedCwd = path.resolve(cwd || this.workspaceDir);
    const workspaceRoot = path.resolve(this.workspaceDir);
    if (normalizedCwd !== workspaceRoot && !normalizedCwd.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error(`${profile} Profile은 /workspace 밖의 cwd에서 실행할 수 없습니다.`);
    }

    const helperName = `agent-hub-antigravity-${crypto.randomUUID().slice(0, 12)}`;
    const workspaceMode = profile === 'READ_ONLY' ? 'ro' : 'rw';
    const profileGuard = profile === 'READ_ONLY'
      ? '[Execution Profile: READ_ONLY] 파일/설정/외부 시스템을 변경하지 말고 읽기와 분석만 수행하세요.'
      : '[Execution Profile: WORKSPACE] 파일 변경은 /workspace 아래로 제한하세요. SSH/Docker 등 외부 인프라 변경은 수행하지 마세요.';
    const agyArgs = ['--print', `${profileGuard}\n\n${prompt}`, '--output-format', 'json', '--effort', 'medium', '--dangerously-skip-permissions'];
    if (model && model !== 'default') agyArgs.push('--model', model);
    if (nativeSessionRef) agyArgs.push('--conversation', nativeSessionRef);

    const dockerArgs = [
      'run', '--rm', '--name', helperName,
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '-e', 'HOME=/root', '-e', 'CI=true',
      '-v', `${runtime.workspaceSource}:/workspace:${workspaceMode}`,
      '-v', `${runtime.geminiHomeSource}:/root/.gemini:rw`
    ];
    if (runtime.uploadsSource && fs.existsSync('/data/uploads')) dockerArgs.push('-v', `${runtime.uploadsSource}:/data/uploads:ro`);
    dockerArgs.push('-w', normalizedCwd, '--entrypoint', 'agy', runtime.image, ...agyArgs);

    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.GH_TOKEN;
      delete env.GITHUB_TOKEN;
      delete env.TELEGRAM_BOT_TOKEN;
      const child = spawn('docker', dockerArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; let isFinished = false;
      const finishError = async (error) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        await this.removeHelperContainer(helperName);
        reject(error);
      };
      const timer = setTimeout(() => {
        if (!isFinished) {
          child.kill('SIGKILL');
          finishError(new Error(`Antigravity ${profile} 실행 타임아웃 (${timeoutMs / 1000}초 초과)`));
        }
      }, timeoutMs);
      if (signal) signal.addEventListener('abort', () => {
        if (!isFinished) {
          child.kill('SIGKILL');
          finishError(new Error('Antigravity 작업이 사용자에 의해 중단되었습니다.'));
        }
      }, { once: true });
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => finishError(new Error(`Antigravity restricted helper 시작 실패: ${err.message}`)));
      child.on('close', (code) => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        const raw = stdout.trim();
        const diagnostic = stderr.trim();
        if (code !== 0) {
          reject(new Error(`Antigravity ${profile} 실행 실패 (Exit code: ${code}):\n${diagnostic || raw || `Exit code: ${code}`}`));
          return;
        }
        try { resolve(this.parseExecutionResult(raw, nativeSessionRef)); }
        catch (error) { reject(error); }
      });
    });
  }

  async executePrompt(options = {}) {
    const { prompt, model, nativeSessionRef, profile = 'WORKSPACE', cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;
    const normalizedProfile = ['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS'].includes(profile) ? profile : 'WORKSPACE';
    if (normalizedProfile !== 'FULL_ACCESS') {
      return this.executeRestrictedPrompt({ prompt, model, nativeSessionRef, profile: normalizedProfile, cwd, timeoutMs, signal });
    }

    return new Promise((resolve, reject) => {
      const profileGuard = '[Execution Profile: FULL_ACCESS] 사용자가 요청한 범위에서 인프라 도구 사용이 허용됩니다.';
      const args = ['--print', `${profileGuard}\n\n${prompt}`, '--output-format', 'json', '--effort', 'medium', '--dangerously-skip-permissions'];
      if (model && model !== 'default') args.push('--model', model);
      if (nativeSessionRef) args.push('--conversation', nativeSessionRef);

      const child = spawn('agy', args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = ''; let isFinished = false;
      const timer = setTimeout(() => { if (!isFinished) { isFinished = true; child.kill('SIGKILL'); reject(new Error(`Antigravity 실행 타임아웃 (${timeoutMs / 1000}초 초과)`)); } }, timeoutMs);
      if (signal) signal.addEventListener('abort', () => { if (!isFinished) { isFinished = true; clearTimeout(timer); child.kill('SIGKILL'); reject(new Error('Antigravity 작업이 사용자에 의해 중단되었습니다.')); } }, { once: true });
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); }); child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => { if (isFinished) return; isFinished = true; clearTimeout(timer); reject(new Error(`Antigravity 프로세스 시작 실패: ${err.message}`)); });
      child.on('close', (code) => {
        if (isFinished) return; isFinished = true; clearTimeout(timer);
        const raw = stdout.trim(); const diagnostic = stderr.trim();
        if (code !== 0) { reject(new Error(`Antigravity 실행 실패 (Exit code: ${code}):\n${diagnostic || raw || `Exit code: ${code}`}`)); return; }
        try { resolve(this.parseExecutionResult(raw, nativeSessionRef)); }
        catch (error) { reject(error); }
      });
    });
  }
}
