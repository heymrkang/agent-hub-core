import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreviewRuntime, PreviewRuntimeError } from '../../src/preview/preview-runtime.js';

function dockerFake({ imagePresent = true, managed = true, coreMount = null } = {}) {
  const calls = [];
  const options = [];
  const run = async (args, runOptions) => {
    calls.push(args);
    options.push(runOptions);
    if (args[0] === 'network' && args[1] === 'inspect') {
      const error = new Error('not found');
      error.stderr = 'network not found';
      throw error;
    }
    if (args[0] === 'image' && args[1] === 'inspect' && !imagePresent) throw new Error('missing image');
    if (args[0] === 'create') return { stdout: 'container-123\n', stderr: '' };
    if (args[0] === 'container' && args[1] === 'inspect') {
      return { stdout: JSON.stringify([{
        Id: args[2], Name: '/preview',
        Config: { Labels: managed ? { 'agent-hub.managed': 'true', 'agent-hub.type': 'preview' } : {} },
        State: { Status: 'running', Running: true, ExitCode: 0 },
        NetworkSettings: { Networks: { 'agent-hub-preview': {} } },
        Mounts: coreMount ? [coreMount] : []
      }]) };
    }
    if (args[0] === 'logs') return { stdout: 'out\n', stderr: 'err\n' };
    if (args[0] === 'exec' && args.includes('node') && args.at(-5) === 'preview') {
      return { stdout: JSON.stringify({ reachable: true, statusCode: 404, contentType: 'application/json', body: null }), stderr: '' };
    }
    if (args[0] === 'exec') return { stdout: '[3000,5173]', stderr: '' };
    if (args[0] === 'ps') return { stdout: 'one\ntwo\n' };
    return { stdout: '', stderr: '' };
  };
  return { calls, options, run };
}

const preview = { id: 'preview-1', session_id: 'session-1', public_hostname: 'preview-app-a31f.12190529.xyz' };
const runtime = {
  projectPath: '/home/dev/workspace/app', packageManager: 'pnpm',
  command: { executable: 'pnpm', args: ['run', 'dev'] }
};

test('격리된 managed Preview container 생성 인자를 구성한다', async () => {
  const fake = dockerFake({ imagePresent: false });
  const docker = new PreviewRuntime({ run: fake.run });
  const created = await docker.create({ preview, runtime });
  assert.equal(created.id, 'container-123');
  assert.deepEqual(created.command, [
    'sh', '-c', 'corepack pnpm install --frozen-lockfile --prod=false && exec "$@"',
    'preview-runtime', 'corepack', 'pnpm', 'run', 'dev'
  ]);
  const create = fake.calls.find(([command]) => command === 'create');
  assert.ok(create.includes('agent-hub.managed=true'));
  assert.ok(create.includes('agent-hub.type=preview'));
  assert.ok(create.includes('agent-hub.preview-id=preview-1'));
  assert.ok(create.some((value, index) => value === 'CI=true' && create[index - 1] === '--env'));
  assert.ok(create.some((value, index) => value === '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=preview-app-a31f.12190529.xyz' && create[index - 1] === '--env'));
  assert.ok(create.some((value, index) => value === '/tmp:rw,exec,nosuid,nodev,size=2g' && create[index - 1] === '--tmpfs'));
  assert.ok(create.includes('--read-only'));
  assert.ok(create.some((value, index) => value === 'ALL' && create[index - 1] === '--cap-drop'));
  assert.ok(create.some((value, index) => value === 'no-new-privileges:true' && create[index - 1] === '--security-opt'));
  assert.ok(create.includes('type=bind,source=/home/dev/workspace/app,target=/workspace'));
  assert.equal(create.some((value) => value.includes('docker.sock') || value.includes('/root/.codex') || value.includes('/data/ssh')), false);
  assert.ok(fake.calls.some(([a]) => a === 'pull'));
});

test('BACKEND_API의 .env.preview 값만 안전하게 주입하고 모든 환경 파일을 마스킹한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-preview-runtime-'));
  try {
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=production-secret\n');
    fs.mkdirSync(path.join(root, 'apps', 'api'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'api', '.env.local'), 'TOKEN=local-secret\n');
    const previewEnvironmentFile = path.join(root, 'apps', 'api', '.env.preview');
    fs.writeFileSync(previewEnvironmentFile, 'MONGODB_URI=mongodb://fixture-secret/dev\n');
    const fake = dockerFake();
    const docker = new PreviewRuntime({ run: fake.run });
    await docker.create({ preview, runtime: {
      ...runtime,
      installPath: root,
      projectPath: path.join(root, 'apps', 'api'),
      packageManager: 'npm',
      command: { executable: 'npm', args: ['run', 'start:dev'] },
      maskEnvironmentFiles: true,
      previewEnvironmentFile,
      previewEnvironment: { MONGODB_URI: 'mongodb://fixture-secret/dev' }
    } });
    const create = fake.calls.find(([command]) => command === 'create');
    assert.ok(create.includes('type=bind,source=/dev/null,target=/workspace/.env,readonly'));
    assert.ok(create.includes('type=bind,source=/dev/null,target=/workspace/apps/api/.env.local,readonly'));
    assert.ok(create.includes('type=bind,source=/dev/null,target=/workspace/apps/api/.env.preview,readonly'));
    assert.ok(create.includes('agent-hub.data-isolation=verified'));
    assert.ok(create.some((value, index) => value === 'MONGODB_URI' && create[index - 1] === '--env'));
    assert.equal(create.some((value) => value.includes('production-secret') || value.includes('local-secret') || value.includes('fixture-secret')), false);
    const createOptions = fake.options[fake.calls.indexOf(create)];
    assert.equal(createOptions.env.MONGODB_URI, 'mongodb://fixture-secret/dev');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lockfile package manager별 재현 가능한 설치 후 dev command를 실행한다', async () => {
  for (const [packageManager, command, expected] of [
    ['npm', { executable: 'npm', args: ['run', 'dev'] }, ['npm ci --include=dev && exec "$@"', 'npm', 'run', 'dev']],
    ['yarn', { executable: 'yarn', args: ['run', 'dev'] }, ['corepack yarn install --immutable && exec "$@"', 'corepack', 'yarn', 'run', 'dev']]
  ]) {
    const fake = dockerFake();
    const docker = new PreviewRuntime({ run: fake.run });
    const created = await docker.create({ preview, runtime: { ...runtime, packageManager, command } });
    assert.equal(created.command[2], expected[0]);
    assert.deepEqual(created.command.slice(4), expected.slice(1));
  }
});

test('수동 override도 install 후 셸 문자열 보간 없이 실행한다', async () => {
  const fake = dockerFake();
  const docker = new PreviewRuntime({ run: fake.run });
  const command = { executable: 'node', args: ['server.js', 'value with spaces', '$(touch /tmp/nope)'] };
  const created = await docker.create({ preview, runtime: { ...runtime, packageManager: 'npm', command } });
  assert.equal(created.command[2], 'npm ci --include=dev && exec "$@"');
  assert.deepEqual(created.command.slice(4), ['node', 'server.js', 'value with spaces', '$(touch /tmp/nope)']);
});

test('managed label 확인 후 lifecycle과 logs를 실행한다', async () => {
  const fake = dockerFake();
  const docker = new PreviewRuntime({ run: fake.run });
  assert.equal((await docker.start('container-1')).running, true);
  assert.equal((await docker.stop('container-1')).status, 'running');
  assert.equal((await docker.restart('container-1')).id, 'container-1');
  assert.equal(await docker.logs('container-1'), 'out\nerr\n');
  assert.deepEqual(await docker.listeningPorts('container-1'), [3000, 5173]);
  assert.deepEqual(await docker.probeHttp('container-1', { port: 3000 }), {
    reachable: true,
    statusCode: 404,
    contentType: 'application/json',
    body: null,
    errorCode: null,
    errorMessage: null
  });
  const probe = fake.calls.find((args) => args[0] === 'exec' && args.at(-5) === 'preview');
  assert.deepEqual(probe.slice(-5), ['preview', '3000', '/', '2000', '0']);
  await docker.remove('container-1');
  assert.deepEqual(await docker.listManaged(), ['one', 'two']);
  assert.ok(fake.calls.some((args) => args.join(' ') === 'rm container-1'));
});

test('비관리 container 조작과 잘못된 옵션을 차단한다', async () => {
  const fake = dockerFake({ managed: false });
  const docker = new PreviewRuntime({ run: fake.run });
  await assert.rejects(() => docker.start('foreign'), (error) => error instanceof PreviewRuntimeError && error.code === 'UNMANAGED_CONTAINER');
  await assert.rejects(() => docker.stop('foreign', { timeoutSeconds: 999 }), (error) => error.code === 'UNMANAGED_CONTAINER');
  await assert.rejects(() => docker.logs('foreign', { tail: 0 }), (error) => error.code === 'UNMANAGED_CONTAINER');
});

test('기존 network도 managed label이 아니면 사용하지 않는다', async () => {
  const run = async (args) => {
    if (args[0] === 'network' && args[1] === 'inspect') return { stdout: JSON.stringify([{ Labels: {} }]) };
    return { stdout: '' };
  };
  const docker = new PreviewRuntime({ run });
  await assert.rejects(() => docker.ensureNetwork(), (error) => error.code === 'UNMANAGED_NETWORK');
});

test('Core container 내부 경로를 Docker host bind 경로로 변환한다', async () => {
  const fake = dockerFake({
    coreMount: { Type: 'bind', Source: '/mnt/storage/agent-hub-core/dev', Destination: '/home/dev' }
  });
  const docker = new PreviewRuntime({ run: fake.run, containerId: 'core-container' });
  await docker.create({ preview, runtime });
  const create = fake.calls.find(([command]) => command === 'create');
  assert.ok(create.includes('type=bind,source=/mnt/storage/agent-hub-core/dev/workspace/app,target=/workspace'));
});

test('monorepo root에서 설치하고 선택 package를 workdir로 실행한다', async () => {
  const fake = dockerFake();
  const docker = new PreviewRuntime({ run: fake.run });
  const created = await docker.create({ preview, runtime: {
    ...runtime,
    projectPath: '/home/dev/workspace/repo/apps/api',
    installPath: '/home/dev/workspace/repo',
    packageManager: 'npm',
    command: { executable: 'npm', args: ['run', 'start:dev'] }
  } });
  assert.equal(created.command[2], 'npm --prefix /workspace ci --include=dev && exec "$@"');
  const create = fake.calls.find(([command]) => command === 'create');
  assert.equal(create[create.indexOf('--workdir') + 1], '/workspace/apps/api');
  assert.ok(create.includes('type=bind,source=/home/dev/workspace/repo,target=/workspace'));
});

test('hasPrisma가 true이면 dev 실행 전 prisma generate를 실행한다', async () => {
  const fake = dockerFake();
  const docker = new PreviewRuntime({ run: fake.run });
  const pnpmCreated = await docker.create({ preview, runtime: { ...runtime, hasPrisma: true } });
  assert.equal(pnpmCreated.command[2], 'corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm exec prisma generate && exec "$@"');

  const npmCreated = await docker.create({ preview, runtime: { ...runtime, packageManager: 'npm', hasPrisma: true } });
  assert.equal(npmCreated.command[2], 'npm ci --include=dev && npx --no-install prisma generate && exec "$@"');
});

