import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProviderAdapter } from '../provider-adapter.js';
import { runtimeConfig } from '../../config/runtime-config.js';
import { parseAntigravityExecutionResponse } from './execution-response.js';

const execFileAsync = promisify(execFile);

export class AntigravityAdapter extends ProviderAdapter {
  constructor() { super('antigravity'); this.workspaceDir = process.env.WORKSPACE_DIR || '/home/dev'; this.defaultTimeoutMs = runtimeConfig.antigravityTimeoutMs; this.modelDiscoveryTimeoutMs = runtimeConfig.antigravityModelDiscoveryTimeoutMs; this.cachedModels = null; this.lastModelCheck = 0; }
  async checkHealth() { try { const { stdout } = await execFileAsync('agy', ['--version'], { timeout: 10000 }); return { healthy: true, version: stdout.trim() }; } catch (error) { return { healthy: false, error: error.message }; } }
  async checkAuth() { const health = await this.checkHealth(); if (!health.healthy) return { authenticated: false, state: 'CLI_UNAVAILABLE', details: `CLI 실행 불가: ${health.error}` }; const geminiDir = path.join(os.homedir(), '.gemini'); const hasCredentialState = fs.existsSync(geminiDir) && fs.readdirSync(geminiDir).length > 0; return hasCredentialState ? { authenticated: null, state: 'CREDENTIAL_PRESENT', details: 'Antigravity 인증 상태 파일 존재. 실제 유효성은 CLI 실행 결과로 검증됩니다.' } : { authenticated: false, state: 'LOGIN_REQUIRED', details: 'Antigravity Google 로그인 필요 (`agy` 대화형 실행)' }; }
  async discoverModels(forceRefresh = false) { const now = Date.now(); if (!forceRefresh && this.cachedModels && now - this.lastModelCheck < 300000) return this.cachedModels; try { const { stdout, stderr } = await execFileAsync('script', ['-q', '-e', '-c', 'agy models', '/dev/null'], { timeout: this.modelDiscoveryTimeoutMs, cwd: this.workspaceDir, env: { ...process.env } }); const raw = `${stdout || ''}\n${stderr || ''}`; const clean = raw.replace(/\x1B\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\r/g, '\n'); const discovered = [], seen = new Set(); for (const originalLine of clean.split('\n')) { let line = originalLine.trim(); if (!line) continue; if (/Fetching available models/i.test(line)) { const modelStart = line.search(/(?:gemini|claude|gpt|oss)[a-z0-9._-]*/i); if (modelStart < 0) continue; line = line.slice(modelStart).trim(); } if (line.startsWith('Model') || line.startsWith('---') || line.startsWith('===') || line.startsWith('Available') || line.toLowerCase().startsWith('usage:')) continue; const match = line.match(/^((?:gemini|claude|gpt|oss)[a-z0-9._-]*)(?:\s{2,}|\t)(.*)$/i) || line.match(/^((?:gemini|claude|gpt|oss)[a-z0-9._-]*)$/i); if (!match) continue; const id = match[1].trim(), displayName = (match[2] || id).trim(); if (!id || seen.has(id)) continue; seen.add(id); discovered.push({ id, name: displayName, default: discovered.length === 0, metadata: { reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: null } }); } if (!discovered.length) throw new Error(`agy models 출력에서 모델을 파싱하지 못했습니다. raw=${clean.trim().slice(0, 500) || '(empty)'}`); this.cachedModels = discovered; this.lastModelCheck = now; console.log(`[AntigravityAdapter] agy models PTY 동적 발견: ${discovered.length}개 모델`); return discovered; } catch (error) { this.cachedModels = null; const diagnostic = { command: 'script -q -e -c "agy models" /dev/null', timeoutMs: this.modelDiscoveryTimeoutMs, code: error?.code ?? null, cwd: this.workspaceDir, message: error?.message || String(error) }; console.error('[AntigravityAdapter] agy models PTY 진단:', diagnostic); throw new Error(`Antigravity 모델 동적 조회 실패 (PTY, 하드코딩 fallback 없음): ${error.message}`); } }
  getCapabilities() { return { authPersistence: 'SUPPORTED', nonInteractive: 'SUPPORTED', jsonOutput: 'SUPPORTED', nativeSessionResume: 'SUPPORTED', modelSwitching: 'SUPPORTED', dynamicModelDiscovery: 'SUPPORTED', multiImage: 'SUPPORTED', nativeCompact: 'UNSUPPORTED', usageMetrics: 'PARTIAL', executionProfiles: 'PARTIAL', reasoningEffort: 'SUPPORTED' }; }
  async getUsageQuota() {
    const { stdout } = await execFileAsync('agy', ['--print', '/usage', '--output-format', 'json'], {
      timeout: 9000,
      cwd: this.workspaceDir,
      env: { ...process.env, CI: 'true' },
      maxBuffer: 1024 * 1024
    });
    let payload;
    try { payload = JSON.parse(stdout.trim()); }
    catch { throw new Error('Antigravity /usage JSON 파싱 실패'); }
    if (payload?.status && payload.status !== 'SUCCESS') throw new Error(`Antigravity /usage 조회 실패: status=${payload.status}`);
    return parseAntigravityUsage(payload);
  }
  buildArgs({ prompt, model, reasoningEffort = 'default', nativeSessionRef, profile = 'WORKSPACE' }) { const normalizedProfile = ['READ_ONLY', 'WORKSPACE', 'FULL_ACCESS'].includes(profile) ? profile : 'WORKSPACE'; const profileGuard = normalizedProfile === 'READ_ONLY' ? `[Execution Profile: READ_ONLY] ${this.workspaceDir}를 포함해 파일/설정/외부 시스템을 변경하지 말고 읽기와 분석만 수행하세요.` : normalizedProfile === 'WORKSPACE' ? `[Execution Profile: WORKSPACE] 파일 변경은 ${this.workspaceDir} 아래로 제한하세요. SSH/Docker 등 외부 인프라 변경은 수행하지 마세요.` : '[Execution Profile: FULL_ACCESS] 사용자가 요청한 범위에서 인프라 도구 사용이 허용됩니다.'; const args = ['--print', `${profileGuard}\n\n${prompt}`, '--output-format', 'json']; if (reasoningEffort && reasoningEffort !== 'default') args.push('--effort', reasoningEffort); if (normalizedProfile !== 'READ_ONLY') args.push('--dangerously-skip-permissions'); if (model && model !== 'default') args.push('--model', model); if (nativeSessionRef) args.push('--conversation', nativeSessionRef); return args; }
  async executePrompt(options = {}) {
    const { prompt, model, reasoningEffort = 'default', nativeSessionRef = null, profile = 'WORKSPACE', cwd = this.workspaceDir, timeoutMs = this.defaultTimeoutMs, signal } = options;
    return new Promise((resolve, reject) => {
      const args = this.buildArgs({ prompt, model, reasoningEffort, nativeSessionRef, profile });
      const child = spawn('agy', args, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', isFinished = false;
      const timer = setTimeout(() => { if (!isFinished) { isFinished = true; child.kill('SIGKILL'); reject(new Error(`Antigravity 실행 타임아웃 (${timeoutMs / 1000}초 초과)`)); } }, timeoutMs);
      if (signal) signal.addEventListener('abort', () => { if (!isFinished) { isFinished = true; clearTimeout(timer); child.kill('SIGKILL'); reject(new Error('Antigravity 작업이 사용자에 의해 중단되었습니다.')); } }, { once: true });
      child.stdout.on('data', c => { stdout += c.toString(); });
      child.stderr.on('data', c => { stderr += c.toString(); });
      child.on('error', err => { if (isFinished) return; isFinished = true; clearTimeout(timer); reject(new Error(`Antigravity 프로세스 시작 실패: ${err.message}`)); });
      child.on('close', code => {
        if (isFinished) return;
        isFinished = true;
        clearTimeout(timer);
        const raw = stdout.trim(), diagnostic = stderr.trim();
        if (code !== 0) {
          const error = new Error(`Antigravity 실행 실패 (Exit code: ${code}):\n${diagnostic || raw || `Exit code: ${code}`}`);
          if (nativeSessionRef) error.code = 'ANTIGRAVITY_NATIVE_RESUME_FAILED';
          return reject(error);
        }
        try {
          resolve(parseAntigravityExecutionResponse(raw, { nativeSessionRef }));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

export function parseAntigravityUsage(payload, fetchedAt = new Date().toISOString()) {
  const groups = payload?.command?.data?.groups;
  if (!Array.isArray(groups)) throw new Error('Antigravity /usage 응답 schema에 command.data.groups가 없습니다.');
  const windows = [];
  let bucketCount = 0;
  for (const group of groups) {
    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    bucketCount += buckets.length;
    for (const bucket of buckets) {
      const fraction = quotaFraction(bucket?.remaining_fraction);
      const resetsAt = quotaTimestamp(bucket?.reset_time);
      if (fraction === null) continue;
      const window = {
        id: String(bucket?.id || `${group?.name || 'group'}-${bucket?.window || bucket?.name || windows.length}`),
        group: String(group?.name || '기타 모델'),
        label: formatAntigravityWindow(bucket?.window, bucket?.name),
        remainingPercent: Math.round(fraction * 100)
      };
      if (resetsAt) window.resetsAt = resetsAt;
      windows.push(window);
    }
  }
  const complete = windows.length > 0 && windows.length === bucketCount && windows.every(window => window.resetsAt);
  return {
    provider: 'antigravity',
    windows,
    fetchedAt,
    source: 'agy --print /usage --output-format json',
    status: windows.length ? (complete ? 'AVAILABLE' : 'PARTIAL') : 'UNAVAILABLE'
  };
}

function quotaFraction(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null; }
function quotaTimestamp(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function formatAntigravityWindow(window, name) {
  if (window === 'weekly') return '주간 한도';
  if (window === '5h') return '5시간 한도';
  return String(name || window || '한도').replace(/\s+Remaining$/i, '');
}
