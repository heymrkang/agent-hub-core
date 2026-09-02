import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { ProviderAdapter } from '../provider-adapter.js';
import { runtimeConfig } from '../../config/runtime-config.js';
import { createCodexExecutionTelemetry } from './execution-telemetry.js';
import { CodexExecJsonlParser } from './exec-jsonl.js';

const execFileAsync = promisify(execFile);

function finishCodexJsonl(parser, { nativeSessionRef = null } = {}) {
  const parsed = parser.finish();
  return {
    response: parsed.response || 'Codex로부터 빈 응답을 받았습니다.',
    nativeSessionRef: parsed.nativeSessionRef,
    nativeSessionCreated: !nativeSessionRef,
    usage: parsed.usage ?? null
  };
}

export class CodexAdapter extends ProviderAdapter {
  constructor() {
    super('codex');
    this.workspaceDir = process.env.WORKSPACE_DIR || '/home/dev';
    this.defaultTimeoutMs = runtimeConfig.codexTimeoutMs;
    this.cachedModels = null;
    this.lastModelCheck = 0;
    this.restrictedRuntime = null;
  }

  async checkHealth() { try { const { stdout } = await execFileAsync('codex', ['--version'], { timeout: 10000 }); return { healthy: true, version: stdout.trim() }; } catch (error) { return { healthy: false, error: error.message }; } }
  async checkAuth() {
    const health = await this.checkHealth(); if (!health.healthy) return { authenticated: false, state: 'CLI_UNAVAILABLE', details: `CLI 실행 불가: ${health.error}` };
    const authFile = path.join(process.env.HOME || '/root', '.codex', 'auth.json');
    return fs.existsSync(authFile) ? { authenticated: null, state: 'CREDENTIAL_PRESENT', details: 'Codex 인증 파일 존재. 실제 인증 유효성은 첫 실행 결과로 검증됩니다.' } : { authenticated: false, state: 'LOGIN_REQUIRED', details: 'Codex 로그인 필요 (컨테이너 내 `codex login`)' };
  }
  async queryAppServerModels() {
    return new Promise((resolve, reject) => {
      const child = spawn('codex', ['app-server', '--stdio'], { cwd: this.workspaceDir, env: { ...process.env, CI: 'true' }, stdio: ['pipe', 'pipe', 'pipe'] }); let buffer = '', stderr = '', settled = false;
      const timer = setTimeout(() => finish(new Error(`Codex app-server model/list 타임아웃: ${stderr.trim() || '응답 없음'}`)), 15000);
      const cleanup = () => { clearTimeout(timer); if (!child.killed) child.kill('SIGTERM'); }; const finish = (error, value) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(value); }; const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
      child.stderr.on('data', c => { stderr += c.toString(); }); child.on('error', e => finish(new Error(`Codex app-server 시작 실패: ${e.message}`))); child.on('close', code => { if (!settled) finish(new Error(`Codex app-server 조기 종료 (code=${code}): ${stderr.trim() || '상세 오류 없음'}`)); });
      child.stdout.on('data', chunk => { buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines.map(l => l.trim()).filter(Boolean)) { let m; try { m = JSON.parse(line); } catch { continue; } if (m.id === 1) { if (m.error) return finish(new Error(`Codex app-server initialize 실패: ${m.error.message || JSON.stringify(m.error)}`)); send({ method: 'initialized', params: {} }); send({ id: 2, method: 'model/list', params: { limit: 100, includeHidden: false } }); } else if (m.id === 2) { if (m.error) return finish(new Error(`Codex model/list 실패: ${m.error.message || JSON.stringify(m.error)}`)); return finish(null, m.result); } } });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent_hub', title: 'Agent Hub', version: '1.0.0' } } });
    });
  }
  async queryAppServerRateLimits() {
    return new Promise((resolve, reject) => {
      const child = spawn('codex', ['app-server', '--stdio'], { cwd: this.workspaceDir, env: { ...process.env, CI: 'true' }, stdio: ['pipe', 'pipe', 'pipe'] }); let buffer = '', stderr = '', settled = false;
      const timer = setTimeout(() => finish(new Error(`Codex app-server rateLimits 타임아웃: ${stderr.trim() || '응답 없음'}`)), 10000);
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (!child.killed) child.kill('SIGTERM'); error ? reject(error) : resolve(value); }; const send = payload => child.stdin.write(`${JSON.stringify(payload)}\n`);
      child.stderr.on('data', c => { stderr += c.toString(); }); child.on('error', e => finish(new Error(`Codex app-server 시작 실패: ${e.message}`))); child.on('close', code => { if (!settled) finish(new Error(`Codex app-server 조기 종료 (code=${code}): ${stderr.trim() || '상세 오류 없음'}`)); });
      child.stdout.on('data', chunk => { buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines.map(l => l.trim()).filter(Boolean)) { let m; try { m = JSON.parse(line); } catch { continue; } if (m.id === 1) { if (m.error) return finish(new Error(m.error.message || 'initialize 실패')); send({ method: 'initialized', params: {} }); send({ id: 2, method: 'account/rateLimits/read', params: {} }); } else if (m.id === 2) { if (m.error) return finish(new Error(m.error.message || 'rateLimits 조회 실패')); return finish(null, m.result); } } });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agent_hub', title: 'Agent Hub', version: '1.0.0' } } });
    });
  }
  async getUsageQuota() { return parseCodexRateLimits(await this.queryAppServerRateLimits()); }
  async discoverModels(forceRefresh = false) { const now = Date.now(); if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) return this.cachedModels; try { const result = await this.queryAppServerModels(); const rows = Array.isArray(result?.data) ? result.data : []; const discovered = rows.filter(m => m && !m.hidden).map(m => { const efforts = (m.supportedReasoningEfforts || m.supported_reasoning_efforts || []).map(e => typeof e === 'string' ? e : e?.reasoningEffort || e?.reasoning_effort || e?.value).filter(Boolean); const defaultEffort = m.defaultReasoningEffort || m.default_reasoning_effort || null; return { id: m.model || m.id, name: m.displayName || m.display_name || m.model || m.id, default: Boolean(m.isDefault ?? m.is_default), description: m.description || null, metadata: { reasoningEfforts: [...new Set(efforts)], defaultReasoningEffort: defaultEffort } }; }).filter(m => m.id); if (!discovered.length) throw new Error('model/list가 표시 가능한 모델을 반환하지 않았습니다.'); this.cachedModels = discovered; this.lastModelCheck = now; return discovered; } catch (error) { this.cachedModels = null; throw new Error(`Codex 모델 동적 조회 실패 (app-server model/list): ${error.message}`); } }
  getCapabilities() { return { authPersistence: 'SUPPORTED', nonInteractive: 'SUPPORTED', jsonOutput: 'SUPPORTED', nativeSessionResume: 'SUPPORTED', modelSwitching: 'SUPPORTED', dynamicModelDiscovery: 'SUPPORTED', multiImage: 'SUPPORTED', nativeCompact: 'UNSUPPORTED', usageMetrics: 'PARTIAL', executionProfiles: 'SUPPORTED', reasoningEffort: 'SUPPORTED' }; }
  buildCodexArgs({ prompt, model, reasoningEffort = 'default', nativeSessionRef = null }) {
    const args = nativeSessionRef ? ['exec', 'resume'] : ['exec'];
    if (model && model !== 'default') args.push('-m', model);
    if (reasoningEffort && reasoningEffort !== 'default') args.push('-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
    args.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json');
    if (nativeSessionRef) args.push(nativeSessionRef);
    args.push(prompt);
    return args;
  }
  async getRestrictedRuntime() {
    if (this.restrictedRuntime) return this.restrictedRuntime; const self = process.env.HOSTNAME; if (!self) throw new Error('Restricted Codex 실행을 위한 현재 컨테이너 ID(HOSTNAME)를 확인할 수 없습니다.');
    try { const [{ stdout: imageOut }, { stdout: mountsOut }] = await Promise.all([execFileAsync('docker', ['inspect', self, '--format', '{{.Config.Image}}'], { timeout: 10000 }), execFileAsync('docker', ['inspect', self, '--format', '{{json .Mounts}}'], { timeout: 10000 })]); const image = imageOut.trim(); const mounts = JSON.parse(mountsOut.trim()); const findMount = destination => mounts.find(m => m.Destination === destination); const workspace = findMount(this.workspaceDir); const codexHome = findMount('/root/.codex'); const data = findMount('/data'); if (!image) throw new Error('현재 Agent Hub 이미지 이름을 찾지 못했습니다.'); if (!workspace?.Source) throw new Error(`${this.workspaceDir} host mount source를 찾지 못했습니다.`); if (!codexHome?.Source) throw new Error('/root/.codex host mount source를 찾지 못했습니다.'); this.restrictedRuntime = { image, workspaceSource: workspace.Source, codexHomeSource: codexHome.Source, uploadsSource: data?.Source ? path.join(data.Source, 'uploads') : null }; console.log(`[CodexAdapter] Restricted profile runtime 준비 완료: image=${image}, workspace=${this.workspaceDir}`); return this.restrictedRuntime; } catch (error) { throw new Error(`Restricted Codex 실행 환경 확인 실패: ${error.stderr || error.message}`); }
  }
  async removeHelperContainer(name) { try { await execFileAsync('docker', ['rm', '-f', name], { timeout: 10000 }); } catch {} }
  async executeRestrictedPrompt({ prompt, model, reasoningEffort, nativeSessionRef, profile, cwd, timeoutMs, signal }) {
    const runtime = await this.getRestrictedRuntime(); const normalizedCwd = path.resolve(cwd || this.workspaceDir); const workspaceRoot = path.resolve(this.workspaceDir); if (normalizedCwd !== workspaceRoot && !normalizedCwd.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error(`${profile} Profile은 ${workspaceRoot} 밖의 cwd에서 실행할 수 없습니다.`);
    const helperName = `agent-hub-codex-${crypto.randomUUID().slice(0, 12)}`; const workspaceMode = profile === 'READ_ONLY' ? 'ro' : 'rw'; const codexArgs = this.buildCodexArgs({ prompt, model, reasoningEffort, nativeSessionRef });
    // Restricted profiles run with an immutable container root. Only the workspace mount
    // receives the requested ro/rw mode; transient runtime paths are tmpfs and disappear
    // with the helper container. /root/.codex stays rw so native thread files survive helper removal.
    const dockerArgs = ['run', '--rm', '--name', helperName, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m', '--tmpfs', '/root/.cache:rw,nosuid,nodev,size=64m', '-e', 'HOME=/root', '-e', 'TMPDIR=/tmp', '-e', 'CI=true', '-v', `${runtime.workspaceSource}:${workspaceRoot}:${workspaceMode}`, '-v', `${runtime.codexHomeSource}:/root/.codex:rw`]; if (runtime.uploadsSource && fs.existsSync('/data/uploads')) dockerArgs.push('-v', `${runtime.uploadsSource}:/data/uploads:ro`); dockerArgs.push('-w', normalizedCwd, '--entrypoint', 'codex', runtime.image, ...codexArgs);
    return new Promise((resolve, reject) => {
      const env = { ...process.env }; delete env.GH_TOKEN; delete env.GITHUB_TOKEN; delete env.TELEGRAM_BOT_TOKEN;
      const child = spawn('docker', dockerArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const telemetry = createCodexExecutionTelemetry({ mode: `RESTRICTED:${profile}`, pid: child.pid, cwd: normalizedCwd, timeoutMs });
      const parser = new CodexExecJsonlParser({ expectedThreadId: nativeSessionRef || null, requireThreadId: !nativeSessionRef });
      let stderr = '', parseError = null, isFinished = false;
      const finishError = async (error, reason = 'failed') => { if (isFinished) return; isFinished = true; clearTimeout(timer); telemetry.finish(reason); await this.removeHelperContainer(helperName); reject(error); };
      const timer = setTimeout(() => { if (!isFinished) { telemetry.timeout(); child.kill('SIGKILL'); finishError(new Error(`Codex ${profile} 실행 타임아웃 (${timeoutMs / 1000}초 초과)`), 'timeout'); } }, timeoutMs);
      if (signal) signal.addEventListener('abort', () => { if (!isFinished) { child.kill('SIGKILL'); finishError(new Error('Codex 작업이 사용자에 의해 중단되었습니다.'), 'aborted'); } }, { once: true });
      child.stdout.on('data', c => { telemetry.recordStdout(c); if (!parseError) { try { parser.push(c); } catch (error) { parseError = error; } } });
      child.stderr.on('data', c => { stderr += c.toString(); telemetry.recordStderr(c); });
      child.on('error', e => finishError(new Error(`Codex restricted helper 시작 실패: ${e.message}`), 'spawn_error'));
      child.on('close', code => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        telemetry.finish(code === 0 ? 'completed' : 'failed', { exitCode: code });
        const diagnostic = stderr.trim();
        if (code !== 0) {
          const error = new Error(`Codex ${profile} 실행 실패 (Exit code: ${code}):\n${diagnostic || `Exit code: ${code}`}`);
          if (nativeSessionRef) error.code = 'CODEX_NATIVE_RESUME_FAILED';
          return reject(error);
        }
        if (parseError) return reject(parseError);
        try { resolve(finishCodexJsonl(parser, { nativeSessionRef })); }
        catch (error) { reject(error); }
      });
    });
  }
  async executePrompt(options = {}) {
    const { prompt, model, reasoningEffort = 'default', nativeSessionRef = null, profile = 'WORKSPACE', cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;
    const normalizedProfile = ['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS'].includes(profile) ? profile : 'WORKSPACE';
    if (normalizedProfile !== 'FULL_ACCESS') return this.executeRestrictedPrompt({ prompt, model, reasoningEffort, nativeSessionRef, profile: normalizedProfile, cwd, timeoutMs, signal });
    return new Promise((resolve, reject) => {
      const args = this.buildCodexArgs({ prompt, model, reasoningEffort, nativeSessionRef });
      const child = spawn('codex', args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const telemetry = createCodexExecutionTelemetry({ mode: 'FULL_ACCESS', pid: child.pid, cwd, timeoutMs });
      const parser = new CodexExecJsonlParser({ expectedThreadId: nativeSessionRef || null, requireThreadId: !nativeSessionRef });
      let stderr = '', parseError = null, isFinished = false;
      const finishError = (error, reason = 'failed') => { if (isFinished) return; isFinished = true; clearTimeout(timer); telemetry.finish(reason); reject(error); };
      const timer = setTimeout(() => { if (!isFinished) { telemetry.timeout(); child.kill('SIGKILL'); finishError(new Error(`Codex 실행 타임아웃 (${timeoutMs / 1000}초 초과)`), 'timeout'); } }, timeoutMs);
      if (signal) signal.addEventListener('abort', () => { if (!isFinished) { child.kill('SIGKILL'); finishError(new Error('Codex 작업이 사용자에 의해 중단되었습니다.'), 'aborted'); } }, { once: true });
      child.stdout.on('data', c => { telemetry.recordStdout(c); if (!parseError) { try { parser.push(c); } catch (error) { parseError = error; } } });
      child.stderr.on('data', c => { stderr += c.toString(); telemetry.recordStderr(c); });
      child.on('error', e => finishError(new Error(`Codex 프로세스 시작 실패: ${e.message}`), 'spawn_error'));
      child.on('close', code => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        telemetry.finish(code === 0 ? 'completed' : 'failed', { exitCode: code });
        const diagnostic = stderr.trim();
        if (code !== 0) {
          const error = new Error(`Codex 실행 실패 (Exit code: ${code}):\n${diagnostic || `Exit code: ${code}`}`);
          if (nativeSessionRef) error.code = 'CODEX_NATIVE_RESUME_FAILED';
          return reject(error);
        }
        if (parseError) return reject(parseError);
        try { resolve(finishCodexJsonl(parser, { nativeSessionRef })); }
        catch (error) { reject(error); }
      });
    });
  }
}

export function parseCodexRateLimits(result, fetchedAt = new Date().toISOString()) {
  const root = result?.rateLimits || result?.rate_limits || result || {};
  const specs = [['primary', root.primary], ['secondary', root.secondary]];
  const windows = specs.filter(([, value]) => value && typeof value === 'object').map(([id, value]) => {
    const used = numberOrNull(value.usedPercent ?? value.used_percent);
    const duration = numberOrNull(value.windowDurationMins ?? value.window_duration_mins);
    const resetsAt = timestampOrNull(value.resetsAt ?? value.resets_at);
    const window = { id, label: duration ? formatWindowLabel(duration) : id };
    if (used !== null) { window.usedPercent = used; window.remainingPercent = Math.max(0, 100 - used); }
    if (duration !== null) window.windowDurationMins = duration;
    if (resetsAt) window.resetsAt = resetsAt;
    return window;
  });
  const complete = windows.length > 0 && windows.every(w => w.usedPercent !== undefined && w.windowDurationMins !== undefined && w.resetsAt);
  return { provider: 'codex', windows, fetchedAt, source: 'codex app-server account/rateLimits/read', status: windows.length ? (complete ? 'AVAILABLE' : 'PARTIAL') : 'UNAVAILABLE' };
}
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function timestampOrNull(value) { if (value === null || value === undefined || value === '') return null; const ms = typeof value === 'number' && value < 1e12 ? value * 1000 : value; const d = new Date(ms); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function formatWindowLabel(minutes) { if (minutes === 10080) return '주간 한도'; if (minutes % 1440 === 0) return `${minutes / 1440}일 한도`; if (minutes % 60 === 0) return `${minutes / 60}시간 한도`; return `${minutes}분 한도`; }
