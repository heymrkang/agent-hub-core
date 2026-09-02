import fs from 'node:fs';
import path from 'node:path';
import { PreviewFramework, PreviewRuntimeType } from './preview-contract.js';

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

function detectPackageManager(projectPath, developmentRoot) {
  let current = projectPath;
  while (isWithin(developmentRoot, current)) {
    const matches = PACKAGE_MANAGERS.filter(({ lockfile }) => fs.existsSync(path.join(current, lockfile)));
    if (matches.length > 1) {
      throw new RuntimeDetectionError('AMBIGUOUS_PACKAGE_MANAGER', `여러 package manager lockfile이 있습니다: ${matches.map(({ lockfile }) => lockfile).join(', ')}`);
    }
    if (matches.length === 1) return { ...matches[0], installPath: current };
    if (current === developmentRoot) break;
    current = path.dirname(current);
  }
  throw new RuntimeDetectionError('PACKAGE_MANAGER_NOT_FOUND', '선택한 package 또는 상위 workspace에서 지원하는 lockfile(pnpm-lock.yaml, package-lock.json, yarn.lock)을 찾을 수 없습니다.');
}

function normalizeOverride(commandOverride) {
  if (commandOverride === undefined || commandOverride === null) return null;
  if (!Array.isArray(commandOverride) || commandOverride.length === 0 || commandOverride.some((part) => typeof part !== 'string' || !part.trim())) {
    throw new RuntimeDetectionError('INVALID_COMMAND_OVERRIDE', '수동 명령은 비어 있지 않은 문자열 배열이어야 합니다.');
  }
  return { executable: commandOverride[0], args: commandOverride.slice(1), source: 'override' };
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.devDependencies || {}),
    ...Object.keys(manifest.peerDependencies || {})
  ]);
}

function nonEmptyScript(manifest, name) {
  const value = manifest.scripts?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function detectFramework(projectPath, manifest) {
  const dependencies = dependencyNames(manifest);
  const nestSignals = {
    coreDependency: dependencies.has('@nestjs/core'),
    cliConfig: fs.existsSync(path.join(projectPath, 'nest-cli.json')),
    startScript: ['start:dev', 'start', 'start:debug'].some((name) => Boolean(nonEmptyScript(manifest, name)))
  };
  const nestScore = Object.values(nestSignals).filter(Boolean).length;
  const next = dependencies.has('next') || /(?:^|[;&|]\s*)next(?:\s|$)/.test(nonEmptyScript(manifest, 'dev') || '');
  const vite = dependencies.has('vite') || /(?:^|[;&|]\s*)vite(?:\s|$)/.test(nonEmptyScript(manifest, 'dev') || '');
  const confirmed = [
    ...(nestSignals.coreDependency && nestScore >= 2 ? [PreviewFramework.NESTJS] : []),
    ...(next ? [PreviewFramework.NEXTJS] : []),
    ...(vite ? [PreviewFramework.VITE] : [])
  ];

  if (confirmed.length > 1) {
    throw new RuntimeDetectionError('AMBIGUOUS_FRAMEWORK', `여러 Preview framework 신호가 감지됐습니다: ${confirmed.join(', ')}`);
  }
  if (confirmed.length === 0 && (nestSignals.coreDependency || nestSignals.cliConfig)) {
    throw new RuntimeDetectionError('AMBIGUOUS_FRAMEWORK', 'NestJS 신호가 하나뿐이라 runtime을 확정할 수 없습니다. package.json dependency, nest-cli.json, start script를 확인하세요.');
  }
  if (confirmed.length === 0) return { framework: null, runtimeType: PreviewRuntimeType.WEB, signals: Object.freeze([]) };

  const framework = confirmed[0];
  return {
    framework,
    runtimeType: framework === PreviewFramework.NESTJS ? PreviewRuntimeType.BACKEND_API : PreviewRuntimeType.WEB,
    signals: Object.freeze(framework === PreviewFramework.NESTJS
      ? Object.entries(nestSignals).filter(([, present]) => present).map(([name]) => name)
      : [framework === PreviewFramework.NEXTJS ? 'next' : 'vite'])
  };
}

function selectStartScript(manifest, framework) {
  const candidates = framework === PreviewFramework.NESTJS ? ['start:dev', 'start', 'start:debug'] : ['dev'];
  return candidates.find((name) => nonEmptyScript(manifest, name)) || null;
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
    const packageManager = detectPackageManager(projectPath, this.developmentRoot);
    const detected = detectFramework(projectPath, manifest);
    const override = normalizeOverride(commandOverride);
    const startScript = selectStartScript(manifest, detected.framework);
    if (!override && !startScript) {
      const expected = detected.framework === PreviewFramework.NESTJS ? 'start:dev, start, start:debug' : 'dev';
      throw new RuntimeDetectionError('START_SCRIPT_NOT_FOUND', `package.json에 지원하는 start script(${expected})가 없습니다. 수동 명령을 지정해야 합니다.`);
    }

    const command = override || {
      executable: packageManager.executable,
      args: ['run', startScript],
      source: 'detected'
    };

    const relativeWorkingDirectory = path.relative(packageManager.installPath, projectPath);

    return Object.freeze({
      projectPath,
      installPath: packageManager.installPath,
      workingDirectory: relativeWorkingDirectory || '.',
      projectName: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : path.basename(projectPath),
      packageManager: packageManager.name,
      command: Object.freeze({ ...command, args: Object.freeze([...command.args]) }),
      startScript,
      devScript: nonEmptyScript(manifest, 'dev'),
      runtimeType: detected.runtimeType,
      framework: detected.framework,
      detectionSignals: detected.signals
    });
  }
}
