import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DEVELOPMENT_ROOT = '/home/dev';
const PACKAGE_MANAGERS = Object.freeze([
  { name: 'pnpm', lockfile: 'pnpm-lock.yaml', executable: 'pnpm' },
  { name: 'npm', lockfile: 'package-lock.json', executable: 'npm' },
  { name: 'yarn', lockfile: 'yarn.lock', executable: 'yarn' }
]);

export class RuntimeDetectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeDetectionError';
    this.code = code;
  }
}

function resolveDirectory(value, label) {
  if (!value || !path.isAbsolute(value)) {
    throw new RuntimeDetectionError('INVALID_PATH', `${label} 경로는 절대 경로여야 합니다.`);
  }
  let resolved;
  try {
    resolved = fs.realpathSync(value);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new RuntimeDetectionError('PATH_NOT_FOUND', `${label} 경로를 찾을 수 없습니다: ${value}`);
    }
    throw error;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new RuntimeDetectionError('NOT_DIRECTORY', `${label} 경로는 디렉터리여야 합니다: ${value}`);
  }
  return resolved;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readPackageJson(projectPath) {
  const filename = path.join(projectPath, 'package.json');
  let raw;
  try {
    raw = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new RuntimeDetectionError('PACKAGE_JSON_NOT_FOUND', `package.json을 찾을 수 없습니다: ${projectPath}`);
    }
    throw error;
  }
  try {
    const manifest = JSON.parse(raw);
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('object required');
    return manifest;
  } catch {
    throw new RuntimeDetectionError('INVALID_PACKAGE_JSON', `package.json이 올바른 JSON 객체가 아닙니다: ${filename}`);
  }
}

function detectPackageManager(projectPath) {
  const matches = PACKAGE_MANAGERS.filter(({ lockfile }) => fs.existsSync(path.join(projectPath, lockfile)));
  if (matches.length === 0) {
    throw new RuntimeDetectionError('PACKAGE_MANAGER_NOT_FOUND', '지원하는 lockfile(pnpm-lock.yaml, package-lock.json, yarn.lock)을 찾을 수 없습니다.');
  }
  if (matches.length > 1) {
    throw new RuntimeDetectionError('AMBIGUOUS_PACKAGE_MANAGER', `여러 package manager lockfile이 있습니다: ${matches.map(({ lockfile }) => lockfile).join(', ')}`);
  }
  return matches[0];
}

function normalizeOverride(commandOverride) {
  if (commandOverride === undefined || commandOverride === null) return null;
  if (!Array.isArray(commandOverride) || commandOverride.length === 0 || commandOverride.some((part) => typeof part !== 'string' || !part.trim())) {
    throw new RuntimeDetectionError('INVALID_COMMAND_OVERRIDE', '수동 명령은 비어 있지 않은 문자열 배열이어야 합니다.');
  }
  return { executable: commandOverride[0], args: commandOverride.slice(1), source: 'override' };
}

export class PreviewRuntimeDetector {
  constructor({ developmentRoot = DEFAULT_DEVELOPMENT_ROOT } = {}) {
    this.developmentRoot = resolveDirectory(developmentRoot, 'Development root');
  }

  detect({ workspacePath, commandOverride } = {}) {
    const projectPath = resolveDirectory(workspacePath, 'Workspace');
    if (!isWithin(this.developmentRoot, projectPath)) {
      throw new RuntimeDetectionError('WORKSPACE_OUTSIDE_ROOT', `Workspace는 ${this.developmentRoot} 내부여야 합니다.`);
    }

    const manifest = readPackageJson(projectPath);
    const packageManager = detectPackageManager(projectPath);
    const override = normalizeOverride(commandOverride);
    if (!override && (typeof manifest.scripts?.dev !== 'string' || !manifest.scripts.dev.trim())) {
      throw new RuntimeDetectionError('DEV_SCRIPT_NOT_FOUND', 'package.json에 scripts.dev가 없습니다. 수동 명령을 지정해야 합니다.');
    }

    const command = override || {
      executable: packageManager.executable,
      args: ['run', 'dev'],
      source: 'detected'
    };

    return Object.freeze({
      projectPath,
      projectName: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : path.basename(projectPath),
      packageManager: packageManager.name,
      command: Object.freeze({ ...command, args: Object.freeze([...command.args]) }),
      devScript: typeof manifest.scripts?.dev === 'string' ? manifest.scripts.dev.trim() : null
    });
  }
}
