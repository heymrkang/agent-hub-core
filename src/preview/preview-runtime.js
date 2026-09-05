import { execFile } from 'node:child_process';
import fs from 'node:fs';
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

function runtimeCommand(command, packageManager, { installAtWorkspaceRoot = false, hasPrisma = false } = {}) {
  const executable = requireText(command?.executable, '실행 명령');
  const args = command?.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new PreviewRuntimeError('INVALID_INPUT', '실행 명령 인자는 문자열 배열이어야 합니다.');
  }

  const localInstallCommands = {
    npm: ['npm', 'ci', '--include=dev'],
    pnpm: ['corepack', 'pnpm', 'install', '--frozen-lockfile', '--prod=false'],
    yarn: ['corepack', 'yarn', 'install', '--immutable']
  };
  const workspaceInstallCommands = {
    npm: ['npm', '--prefix', '/workspace', 'ci', '--include=dev'],
    pnpm: ['corepack', 'pnpm', '--dir', '/workspace', 'install', '--frozen-lockfile', '--prod=false'],
    yarn: ['corepack', 'yarn', '--cwd', '/workspace', 'install', '--immutable']
  };
  const install = (installAtWorkspaceRoot ? workspaceInstallCommands : localInstallCommands)[packageManager];
  if (!install) {
    throw new PreviewRuntimeError('INVALID_INPUT', `지원하지 않는 package manager입니다: ${packageManager}`);
  }

  const prismaCommands = {
    npm: 'npx --no-install prisma generate',
    pnpm: 'corepack pnpm exec prisma generate',
    yarn: 'corepack yarn prisma generate'
  };

  const commands = [install.join(' ')];
  if (hasPrisma) {
    commands.push(prismaCommands[packageManager] || 'npx prisma generate');
  }

  const development = packageManagerCommand(executable, args);
  const script = `${commands.join(' && ')} && exec "$@"`;
  return ['sh', '-c', script, 'preview-runtime', ...development];
}

function previewEnvironmentArgs(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) return [];
  return Object.keys(environment).flatMap((name) => ['--env', name]);
}

function environmentFileTargets(installPath, projectPath) {
  const targets = [];
  const stack = [installPath];
  while (stack.length) {
    const directory = stack.pop();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { throw new PreviewRuntimeError('ENV_MASK_FAILED', `환경 파일 검색에 실패했습니다: ${error.message}`, error); }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(filename);
        continue;
      }
      if (entry.name !== '.env' && !entry.name.startsWith('.env.')) continue;
      if (!entry.isFile()) {
        throw new PreviewRuntimeError('UNSAFE_ENV_FILE', `symlink 등 일반 파일이 아닌 환경 파일은 Preview에서 허용하지 않습니다: ${filename}`);
      }
      const relative = path.relative(installPath, filename);
      if (relative === '..' || relative.startsWith(`..${path.sep}`)) continue;
      targets.push(path.posix.join('/workspace', relative.split(path.sep).join('/')));
      if (targets.length > 256) throw new PreviewRuntimeError('TOO_MANY_ENV_FILES', '마스킹할 환경 파일이 256개를 초과했습니다.');
    }
  }
  return targets.sort();
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
    const installPath = path.resolve(runtime?.installPath || projectPath);
    if (!path.isAbsolute(runtime?.installPath || runtime?.projectPath)) {
      throw new PreviewRuntimeError('INVALID_INPUT', '설치 경로는 절대 경로여야 합니다.');
    }
    const relativeProjectPath = path.relative(installPath, projectPath);
    if (relativeProjectPath === '..' || relativeProjectPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeProjectPath)) {
      throw new PreviewRuntimeError('INVALID_INPUT', '프로젝트 경로는 package manager 설치 경로 내부여야 합니다.');
    }
    const command = runtimeCommand(runtime.command, runtime.packageManager, {
      installAtWorkspaceRoot: Boolean(relativeProjectPath),
      hasPrisma: Boolean(runtime.hasPrisma)
    });
    await this.ensureNetwork();
    await this.#ensureImage();
    const bindSource = await this.#resolveBindSource(installPath);
    const containerWorkdir = relativeProjectPath ? path.posix.join('/workspace', relativeProjectPath.split(path.sep).join('/')) : '/workspace';

    const expectedEnvironmentFile = path.join(projectPath, '.env.preview');
    if (runtime.previewEnvironmentFile) {
      if (path.resolve(runtime.previewEnvironmentFile) !== expectedEnvironmentFile) {
        throw new PreviewRuntimeError('INVALID_INPUT', '프로젝트 루트의 .env.preview만 사용할 수 있습니다.');
      }
    }

    const name = previewContainerName(previewId);
    const maskedEnvironmentFiles = runtime.maskEnvironmentFiles ? environmentFileTargets(installPath, projectPath) : [];
    const args = [
      'create', '--name', name, '--init',
      '--network', this.network,
      '--network-alias', name,
      '--read-only',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--pids-limit', '256',
      '--memory', '2g',
      '--cpus', '2',
      '--workdir', containerWorkdir,
      '--mount', `type=bind,source=${bindSource},target=/workspace`,
      ...maskedEnvironmentFiles.flatMap((target) => ['--mount', `type=bind,source=/dev/null,target=${target},readonly`]),
      // Yarn Berry creates executable shims below /tmp. A noexec tmpfs makes
      // valid Yarn projects fail with "permission denied" before dev starts.
      '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=2g',
      '--env', 'HOME=/tmp',
      '--env', 'CI=true',
      '--env', `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${preview.public_hostname}`,
      ...previewEnvironmentArgs(runtime.previewEnvironment),
      '--label', 'agent-hub.managed=true',
      '--label', 'agent-hub.type=preview',
      ...(runtime.maskEnvironmentFiles ? ['--label', 'agent-hub.data-isolation=verified'] : []),
      '--label', `agent-hub.preview-id=${previewId}`,
      '--label', `agent-hub.session-id=${sessionId}`,
      this.image,
      ...command
    ];
    const { stdout } = await this.#docker(args, 'CONTAINER_CREATE_FAILED', 30_000, runtime.previewEnvironment);
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

  async probeHttp(containerId, { port, path: requestPath = '/', timeoutMs = 2_000, maxBodyBytes = 0 } = {}) {
    const container = await this.#requireManaged(containerId);
    const targetPort = Number(port);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      throw new PreviewRuntimeError('INVALID_INPUT', `올바르지 않은 HTTP probe port: ${port}`);
    }
    if (typeof requestPath !== 'string' || !requestPath.startsWith('/') || requestPath.startsWith('//') || /[\r\n]/.test(requestPath)) {
      throw new PreviewRuntimeError('INVALID_INPUT', `올바르지 않은 HTTP probe path: ${requestPath}`);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new PreviewRuntimeError('INVALID_INPUT', 'HTTP probe timeout은 1~30000ms 정수여야 합니다.');
    }
    if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 0 || maxBodyBytes > 1024 * 1024) {
      throw new PreviewRuntimeError('INVALID_INPUT', 'HTTP probe body 제한은 0~1048576 bytes 정수여야 합니다.');
    }
    const targetHost = String(container.Name || '').replace(/^\//, '');
    if (!targetHost) throw new PreviewRuntimeError('INVALID_DOCKER_RESPONSE', 'Container hostname을 확인할 수 없습니다.');
    const script = [
      "const http=require('http')",
      "const [host,port,path,timeout]=process.argv.slice(1)",
      "const maxBodyBytes=Number(process.argv[5]||0)",
      "let done=false",
      "const finish=(value)=>{if(done)return;done=true;process.stdout.write(JSON.stringify(value))}",
      "const req=http.request({hostname:host,port:Number(port),path,method:'GET',headers:{host,accept:'application/json,text/html;q=0.9,*/*;q=0.1'}},res=>{const chunks=[];let size=0;res.on('data',chunk=>{if(size>=maxBodyBytes)return;const part=chunk.subarray(0,Math.max(0,maxBodyBytes-size));chunks.push(part);size+=part.length});res.on('end',()=>finish({reachable:true,statusCode:res.statusCode,contentType:res.headers['content-type']||null,body:maxBodyBytes?Buffer.concat(chunks).toString('utf8'):null}))})",
      "req.once('error',error=>finish({reachable:false,errorCode:error.code||'HTTP_ERROR',errorMessage:error.message}))",
      "req.setTimeout(Number(timeout),()=>req.destroy(Object.assign(new Error('request timeout'),{code:'ETIMEDOUT'})))",
      "req.end()"
    ].join(';');
    const { stdout } = await this.#docker([
      'exec', containerId, 'node', '-e', script,
      targetHost, String(targetPort), requestPath, String(timeoutMs), String(maxBodyBytes)
    ], 'HTTP_PROBE_FAILED', timeoutMs + 5_000);
    try {
      const result = JSON.parse(stdout);
      if (
        !result || typeof result !== 'object' || typeof result.reachable !== 'boolean'
        || (result.reachable && (!Number.isInteger(result.statusCode) || result.statusCode < 100 || result.statusCode > 599))
      ) throw new Error('invalid HTTP probe response');
      return Object.freeze({
        reachable: result.reachable,
        statusCode: result.statusCode ?? null,
        contentType: typeof result.contentType === 'string' ? result.contentType : null,
        body: typeof result.body === 'string' ? result.body : null,
        errorCode: typeof result.errorCode === 'string' ? result.errorCode : null,
        errorMessage: typeof result.errorMessage === 'string' ? result.errorMessage.slice(0, 500) : null
      });
    } catch (error) {
      throw new PreviewRuntimeError('INVALID_DOCKER_RESPONSE', 'Container HTTP probe 응답을 해석할 수 없습니다.', error);
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

  async #docker(args, code, timeout = 30_000, environment = null) {
    try {
      return await this.run(args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        ...(environment && Object.keys(environment).length ? { env: { ...process.env, ...environment } } : {})
      });
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '').trim().slice(0, 700);
      throw new PreviewRuntimeError(code, detail || `Docker 명령이 실패했습니다: ${args[0]}`, error);
    }
  }
}
