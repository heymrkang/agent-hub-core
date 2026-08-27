import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const REPOS_ROOT = process.env.REPOS_ROOT || '/workspace/repos';

function redact(value) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let text = String(value || '');
  if (token) text = text.split(token).join('[REDACTED]');
  return text.replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[REDACTED]');
}

function safeRepoPath(repoName) {
  const name = path.basename(String(repoName || '').trim());
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw new Error('Repository 디렉터리 이름이 올바르지 않습니다.');
  const resolved = path.join(REPOS_ROOT, name);
  if (!resolved.startsWith(`${REPOS_ROOT}${path.sep}`)) throw new Error('허용되지 않은 Repository 경로입니다.');
  return resolved;
}

export class GitManager {
  static async init() {
    fs.mkdirSync(REPOS_ROOT, { recursive: true });
    const git = await this.commandVersion('git', ['--version']);
    const gh = await this.commandVersion('gh', ['--version']);
    const tokenConfigured = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
    let authenticated = false;
    let authState = tokenConfigured ? 'TOKEN_PRESENT' : 'NOT_CONFIGURED';

    if (git.available) {
      if (process.env.GIT_USER_NAME) await execFileAsync('git', ['config', '--global', 'user.name', process.env.GIT_USER_NAME], { timeout: 10000 });
      if (process.env.GIT_USER_EMAIL) await execFileAsync('git', ['config', '--global', 'user.email', process.env.GIT_USER_EMAIL], { timeout: 10000 });
    }

    if (tokenConfigured && gh.available) {
      try {
        const env = { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN };
        await execFileAsync('gh', ['auth', 'setup-git'], { timeout: 10000, env });
        await execFileAsync('gh', ['auth', 'status'], { timeout: 10000, env });
        authenticated = true;
        authState = 'READY';
      } catch (error) {
        authState = `ERROR: ${redact(error.stderr || error.message).slice(0, 300)}`;
      }
    }

    console.log(`[Git] git=${git.available ? git.version : 'unavailable'} gh=${gh.available ? gh.version : 'unavailable'} auth=${authState} identity=${process.env.GIT_USER_NAME && process.env.GIT_USER_EMAIL ? 'configured' : 'not-configured'}`);
    return { git, gh, tokenConfigured, authenticated, authState, reposRoot: REPOS_ROOT };
  }

  static async commandVersion(command, args) {
    try {
      const { stdout } = await execFileAsync(command, args, { timeout: 10000 });
      return { available: true, version: stdout.trim().split('\n')[0] };
    } catch (error) {
      return { available: false, error: redact(error.message).slice(0, 300) };
    }
  }

  static async status() {
    const git = await this.commandVersion('git', ['--version']);
    const gh = await this.commandVersion('gh', ['--version']);
    const tokenConfigured = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
    let authenticated = false;
    if (tokenConfigured && gh.available) {
      try {
        const env = { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN };
        await execFileAsync('gh', ['auth', 'status'], { timeout: 10000, env });
        authenticated = true;
      } catch {}
    }
    return { git, gh, tokenConfigured, authenticated, reposRoot: REPOS_ROOT, identityConfigured: Boolean(process.env.GIT_USER_NAME && process.env.GIT_USER_EMAIL) };
  }

  static listRepositories() {
    fs.mkdirSync(REPOS_ROOT, { recursive: true });
    return fs.readdirSync(REPOS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(REPOS_ROOT, entry.name, '.git')))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  static async clone(remote, directory = null) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(String(remote || '').trim())) {
      throw new Error('V1 Git clone은 https://github.com/owner/repo 형식만 지원합니다. Token을 URL에 넣지 마세요.');
    }
    const derived = path.basename(remote.replace(/\.git$/, ''));
    const target = safeRepoPath(directory || derived);
    if (fs.existsSync(target)) throw new Error(`이미 디렉터리가 존재합니다: ${target}`);
    const env = { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN };
    try {
      await execFileAsync('git', ['clone', remote, target], { cwd: REPOS_ROOT, timeout: 120000, env });
      return target;
    } catch (error) {
      throw new Error(redact(error.stderr || error.message).slice(0, 1500));
    }
  }

  static async inspect(repoName) {
    const cwd = safeRepoPath(repoName);
    if (!fs.existsSync(path.join(cwd, '.git'))) throw new Error('Git repository가 아닙니다.');
    const env = { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN };
    const run = async (args) => (await execFileAsync('git', args, { cwd, timeout: 15000, env })).stdout.trim();
    const [branch, status, remote, upstream] = await Promise.all([
      run(['branch', '--show-current']).catch(() => ''),
      run(['status', '--short']).catch(() => ''),
      run(['remote', 'get-url', 'origin']).catch(() => ''),
      run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')
    ]);
    return { cwd, branch, status, remote: redact(remote), upstream };
  }
}

export { REPOS_ROOT };
