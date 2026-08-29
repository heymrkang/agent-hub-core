import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewRuntime, PreviewRuntimeError } from '../../src/preview/preview-runtime.js';

function dockerFake({ imagePresent = true, managed = true, coreMount = null } = {}) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
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
    if (args[0] === 'ps') return { stdout: 'one\ntwo\n' };
    return { stdout: '', stderr: '' };
  };
  return { calls, run };
}

const preview = { id: 'preview-1', session_id: 'session-1' };
const runtime = {
  projectPath: '/home/dev/workspace/app', packageManager: 'pnpm',
  command: { executable: 'pnpm', args: ['run', 'dev'] }
};

test('격리된 managed Preview container 생성 인자를 구성한다', async () => {
  const fake = dockerFake({ imagePresent: false });
  const docker = new PreviewRuntime({ run: fake.run });
  const created = await docker.create({ preview, runtime });
  assert.equal(created.id, 'container-123');
  assert.deepEqual(created.command, ['corepack', 'pnpm', 'run', 'dev']);
  const create = fake.calls.find(([command]) => command === 'create');
  assert.ok(create.includes('agent-hub.managed=true'));
  assert.ok(create.includes('agent-hub.type=preview'));
  assert.ok(create.includes('agent-hub.preview-id=preview-1'));
  assert.ok(create.includes('type=bind,source=/home/dev/workspace/app,target=/workspace'));
  assert.equal(create.some((value) => value.includes('docker.sock') || value.includes('/root/.codex') || value.includes('/data/ssh')), false);
  assert.ok(fake.calls.some(([a]) => a === 'pull'));
});

test('managed label 확인 후 lifecycle과 logs를 실행한다', async () => {
  const fake = dockerFake();
  const docker = new PreviewRuntime({ run: fake.run });
  assert.equal((await docker.start('container-1')).running, true);
  assert.equal((await docker.stop('container-1')).status, 'running');
  assert.equal((await docker.restart('container-1')).id, 'container-1');
  assert.equal(await docker.logs('container-1'), 'out\nerr\n');
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
