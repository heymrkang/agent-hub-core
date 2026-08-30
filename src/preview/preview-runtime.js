import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_IMAGE = 'node:22-bookworm-slim';
const DEFAULT_NETWORK = 'agent-hub-preview';
const MANAGED_LABELS = Object.freeze({
  'agent-hub.managed': 'true',
  'agent-hub.type': 'preview'
});

export class PreviewRuntimeError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PreviewRuntimeError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PreviewRuntimeError('INVALID_INPUT', `${label} 값이 필요합니다.`);
  }
  return value.trim();
}

function assertSafeLabelValue(value, label) {
  const normalized = requireText(value, label);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(normalized)) {
    throw new PreviewRuntimeError('INVALID_INPUT', `${label} 값에 허용되지 않은 문자가 있습니다.`);
  }
  return normalized;
}

export function previewContainerName(previewId) {
  return `agent-hub-preview-${previewId.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`.slice(0, 128);
}

function packageManagerCommand(executable, args) {
  if (executable === 'pnpm' || executable === 'yarn') {
    return ['corepack', executable, ...args];
  }
  return [executable, ...args];
}

function runtimeCommand(command, packageManager) {
  const executable = requireText(command?.executable, '실행 명령');
  const args = command?.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new PreviewRuntimeError('INVALID_INPUT', '실행 명령 인자는 문자열 배열이어야 합니다.');
  }

  const installCommands = {
    npm: ['npm', 'ci', '--include=dev'],
    pnpm: ['corepack', 'pnpm', 'install', '--frozen-lockfile', '--prod=false'],
    yarn: ['corepack', 'yarn', 'install', '--immutable']
  };
  const install = installCommands[packageManager];
  if (!install) {
    throw new PreviewRuntimeError('INVALID_INPUT', `지원하지 않는 package manager입니다: ${packageManager}`);
  }

  const development = packageManagerCommand(executable, args);
  const script = `${install.join(' ')} && exec "$@"`;
  return ['sh', '-c', script, 'preview-runtime', ...development];
}

export class PreviewRuntime {
  constructor({
    image = process.env.PREVIEW_NODE_IMAGE || DEFAULT_IMAGE,
    network = process.env.PREVIEW_DOCKER_NETWORK || DEFAULT_NETWORK,
    run = (args, options) => execFileAsync('docker', args, options),
    containerId = process.env.HOSTNAME || null
  } = {}) {
    this.image = requireText(image, 'Preview image');
    this.network = assertSafeLabelValue(network, 'Preview network');
    this.run = run;
    this.containerId = containerId;
    this.mounts = null;
  }

  async ensureNetwork() {
    try {
      const network = await this.#inspect(this.network, 'network');
      const labels = network?.Labels || {};
      if (labels['agent-hub.managed'] !== 'true' || labels['agent-hub.type'] !== 'preview-network') {
        throw new PreviewRuntimeError('UNMANAGED_NETWORK', `동일 이름의 비관리 Docker network가 있습니다: ${this.network}`);
      }
      return this.network;
    } catch (error) {
      if (error instanceof PreviewRuntimeError && error.code !== 'NOT_FOUND') throw error;
    }

    await this.#docker([
      'network', 'create',
      '--label', 'agent-hub.managed=true',
      '--label', 'agent-hub.type=preview-network',
      this.network
    ], 'NETWORK_CREATE_FAILED');
    return this.network;
  }

  async create({ preview, runtime }) {
    const previewId = assertSafeLabelValue(preview?.id, 'Preview ID');
    const sessionId = assertSafeLabelValue(preview?.session_id, 'Session ID');
    const projectPath = path.resolve(requireText(runtime?.projectPath, '프로젝트 경로'));
    if (!path.isAbsolute(runtime?.projectPath)) {
      throw new PreviewRuntimeError('INVALID_INPUT', '프로젝트 경로는 절대 경로여야 합니다.');
    }
    const command = runtimeCommand(runtime.command, runtime.packageManager);
    await this.ensureNetwork();
    await this.#ensureImage();
    const bindSource = await this.#resolveBindSource(projectPath);

    const name = previewContainerName(previewId);
    const args = [
      'create', '--name', name, '--init',
      '--network', this.network,
      '--network-alias', name,
      '--workdir', '/workspace',
      '--mount', `type=bind,source=${bindSource},target=/workspace`,
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '--env', 'HOME=/tmp',
      '--env', 'CI=true',
      '--label', 'agent-hub.managed=true',
      '--label', 'agent-hub.type=preview',
      '--label', `agent-hub.preview-id=${previewId}`,
      '--label', `agent-hub.session-id=${sessionId}`,
      this.image,
      ...command
    ];
    const { stdout } = await this.#docker(args, 'CONTAINER_CREATE_FAILED');
    return { id: stdout.trim(), name, command };
  }

  async start(containerId) {
    await this.#requireManaged(containerId);
    await this.#docker(['start', containerId], 'CONTAINER_START_FAILED');
    return this.inspect(containerId);
  }

  async stop(containerId, { timeoutSeconds = 10 } = {}) {
    await this.#requireManaged(containerId);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 300) {
      throw new PreviewRuntimeError('INVALID_INPUT', '정지 timeout은 0~300초 정수여야 합니다.');
    }
    await this.#docker(['stop', '--time', String(timeoutSeconds), containerId], 'CONTAINER_STOP_FAILED');
    return this.inspect(containerId);
  }

  async remove(containerId, { force = false } = {}) {
    await this.#requireManaged(containerId);
    await this.#docker(['rm', ...(force ? ['--force'] : []), containerId], 'CONTAINER_REMOVE_FAILED');
  }

  async restart(containerId, { timeoutSeconds = 10 } = {}) {
    await this.#requireManaged(containerId);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 300) {
      throw new PreviewRuntimeError('INVALID_INPUT', '재시작 timeout은 0~300초 정수여야 합니다.');
    }
    await this.#docker(['restart', '--time', String(timeoutSeconds), containerId], 'CONTAINER_RESTART_FAILED');
    return this.inspect(containerId);
  }

  async logs(containerId, { tail = 200 } = {}) {
    await this.#requireManaged(containerId);
    if (!Number.isInteger(tail) || tail < 1 || tail > 5000) {
      throw new PreviewRuntimeError('INVALID_INPUT', '로그 tail은 1~5000 사이 정수여야 합니다.');
    }
    const { stdout, stderr } = await this.#docker(['logs', '--tail', String(tail), containerId], 'CONTAINER_LOGS_FAILED');
    return `${stdout || ''}${stderr || ''}`;
  }

  async listeningPorts(containerId) {
    await this.#requireManaged(containerId);
    const script = [
      "const fs=require('fs')",
      "const files=['/proc/net/tcp','/proc/net/tcp6']",
      "const ports=new Set()",
      "for(const file of files){let raw='';try{raw=fs.readFileSync(file,'utf8')}catch{}",
      "for(const line of raw.trim().split('\\n').slice(1)){const fields=line.trim().split(/\\s+/);if(fields[3]!=='0A')continue;const [address,hexPort]=fields[1].split(':');if(address==='0B00007F')continue;const port=parseInt(hexPort,16);if(port>0)ports.add(port)}}",
      "process.stdout.write(JSON.stringify([...ports].sort((a,b)=>a-b)))"
    ].join(';');
    const { stdout } = await this.#docker(['exec', containerId, 'node', '-e', script], 'LISTENING_PORTS_FAILED');
    try {
      const ports = JSON.parse(stdout);
      if (!Array.isArray(ports) || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('invalid ports');
      return ports;
    } catch (error) {
      throw new PreviewRuntimeError('INVALID_DOCKER_RESPONSE', 'Container listening port 응답을 해석할 수 없습니다.', error);
    }
  }

  async inspect(containerId) {
    const container = await this.#requireManaged(containerId);
    return {
      id: container.Id,
      name: String(container.Name || '').replace(/^\//, ''),
      status: container.State?.Status || null,
      running: Boolean(container.State?.Running),
      exitCode: container.State?.ExitCode ?? null,
      labels: { ...(container.Config?.Labels || {}) },
      networks: Object.keys(container.NetworkSettings?.Networks || {})
    };
  }

  async listManaged({ all = true } = {}) {
    const { stdout } = await this.#docker([
      'ps', ...(all ? ['--all'] : []), '--quiet',
      '--filter', 'label=agent-hub.managed=true',
      '--filter', 'label=agent-hub.type=preview'
    ], 'CONTAINER_LIST_FAILED');
    return stdout.trim().split('\n').filter(Boolean);
  }

  async #ensureImage() {
    try {
      await this.#docker(['image', 'inspect', this.image], 'IMAGE_NOT_FOUND');
    } catch (error) {
      if (!(error instanceof PreviewRuntimeError) || error.code !== 'IMAGE_NOT_FOUND') throw error;
      await this.#docker(['pull', this.image], 'IMAGE_PULL_FAILED', 300_000);
    }
  }

  async #resolveBindSource(projectPath) {
    if (!this.containerId) return projectPath;
    if (this.mounts === null) {
      try {
        const ownContainer = await this.#inspect(assertSafeLabelValue(this.containerId, 'Core container ID'), 'container');
        this.mounts = Array.isArray(ownContainer.Mounts) ? ownContainer.Mounts : [];
      } catch (error) {
        if (!(error instanceof PreviewRuntimeError) || error.code !== 'NOT_FOUND') throw error;
        this.mounts = [];
      }
    }
    const candidates = this.mounts
      .filter((mount) => mount?.Type === 'bind' && path.isAbsolute(mount.Source) && path.isAbsolute(mount.Destination))
      .filter((mount) => projectPath === mount.Destination || projectPath.startsWith(`${mount.Destination}${path.sep}`))
      .sort((a, b) => b.Destination.length - a.Destination.length);
    if (!candidates.length) return projectPath;
    return path.join(candidates[0].Source, path.relative(candidates[0].Destination, projectPath));
  }

  async #requireManaged(containerId) {
    const id = assertSafeLabelValue(containerId, 'Container ID');
    const container = await this.#inspect(id, 'container');
    const labels = container?.Config?.Labels || {};
    if (Object.entries(MANAGED_LABELS).some(([key, value]) => labels[key] !== value)) {
      throw new PreviewRuntimeError('UNMANAGED_CONTAINER', `Agent Hub 관리 Preview container가 아닙니다: ${id}`);
    }
    return container;
  }

  async #inspect(id, type) {
    try {
      const { stdout } = await this.run([type, 'inspect', id], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
      const parsed = JSON.parse(stdout);
      if (!Array.isArray(parsed) || !parsed[0]) throw new Error('empty inspect result');
      return parsed[0];
    } catch (error) {
      if (error instanceof SyntaxError) throw new PreviewRuntimeError('INVALID_DOCKER_RESPONSE', 'Docker inspect 응답을 해석할 수 없습니다.', error);
      if (error instanceof PreviewRuntimeError) throw error;
      throw new PreviewRuntimeError('NOT_FOUND', `Docker ${type}을 찾을 수 없습니다: ${id}`, error);
    }
  }

  async #docker(args, code, timeout = 30_000) {
    try {
      return await this.run(args, { timeout, maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '').trim().slice(0, 700);
      throw new PreviewRuntimeError(code, detail || `Docker 명령이 실패했습니다: ${args[0]}`, error);
    }
  }
}
