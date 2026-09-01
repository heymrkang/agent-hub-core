import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuSeverity, usageSeverity, RESOURCE_THRESHOLDS } from '../../src/system/resource-severity.js';
import { REMOTE_SCRIPT, SystemService } from '../../src/system/system-service.js';
import { detailKeyboard, handleSystemCallback, handleSystemCommand, overviewKeyboard, renderOverview, renderSystem } from '../../src/telegram/commands/system.js';

const host = { user_id: 1, alias: 'dev', host: '192.168.0.10', enabled: 1 };
const remoteOutput = `HOST\tdev-host\tUbuntu 24.04 LTS\t6.8.0\tx86_64\t86400
CPU1\tcpu  100 0 100 800 0 0 0 0 0 0
CPU2\tcpu  110 0 110 880 0 0 0 0 0 0
TEMP\tPackage id 0\t47500
TEMP\tPackage id 0\t41500
TEMP\tPackage id 0\t42500
LOAD\t0.20 0.10 0.05 1/100 1
CORES\t4
MEM\tMemTotal:\t1000
MEM\tMemAvailable:\t400
MEM\tSwapTotal:\t200
MEM\tSwapFree:\t150
DISK\t/dev/sda1\t1000\t300\t700\t30%\t/
DISK\t/dev/sda1\t1000\t300\t700\t30%\t/home/dev
DOCKER\tavailable\t27.0\t2\t1\t0\t0\t5
RUNTIME\tavailable\t/docker-agent-telegram\trunning\thealthy\t0\t2026-09-01T00:00:00Z
STATS\t1.2%\t100MiB / 1GiB\t10%`;

test('원격 수집 스크립트는 os-release 값을 셸 변수 문자열이 아닌 실제 OS명으로 출력한다', () => {
  assert.doesNotMatch(REMOTE_SCRIPT, /\\\$\{PRETTY_NAME/);
  assert.match(REMOTE_SCRIPT, /PRETTY_NAME=/);
});

test('CPU는 0.5초 간격 4개 구간을 수집하고 온도는 워밍업 후 3회 조회한다', () => {
  assert.match(REMOTE_SCRIPT, /for sample in 1 2 3 4/);
  assert.match(REMOTE_SCRIPT, /for temp_sample in 1 2 3/);
  assert.match(REMOTE_SCRIPT, /sleep 0\.5/);
  assert.match(REMOTE_SCRIPT, /\/sys\/class\/hwmon/);
});

test('resource 임계값은 OK/WARN/CRITICAL/UNKNOWN을 구분한다', () => {
  assert.equal(usageSeverity(79.9, RESOURCE_THRESHOLDS.disk), 'OK');
  assert.equal(usageSeverity(80, RESOURCE_THRESHOLDS.disk), 'WARN');
  assert.equal(usageSeverity(90, RESOURCE_THRESHOLDS.disk), 'CRITICAL');
  assert.equal(usageSeverity(null, RESOURCE_THRESHOLDS.disk), 'UNKNOWN');
});

test('CPU는 순간 사용률만으로 CRITICAL이 되지 않는다', () => {
  assert.equal(cpuSeverity({ usagePercent: 99, load1: 0.2, cores: 4 }), 'WARN');
  assert.equal(cpuSeverity({ usagePercent: 99, load1: 4, cores: 4 }), 'CRITICAL');
});

test('원격 응답을 공통 리소스와 Docker/Runtime으로 파싱한다', () => {
  const snapshot = new SystemService().parse(host, remoteOutput);
  assert.equal(snapshot.online, true);
  assert.equal(snapshot.host.hostname, 'dev-host');
  assert.equal(snapshot.cpu.sampleCount, 1);
  assert.equal(snapshot.cpu.temperatureCelsius, 43.833333333333336);
  assert.equal(snapshot.memory.usagePercent, 60);
  assert.deepEqual(snapshot.disks.items[0].paths, ['/', '/home/dev']);
  assert.equal(snapshot.docker.running, 2);
  assert.equal(snapshot.runtime.name, 'docker-agent-telegram');
});

test('서버별 캐시를 재사용하고 SSH 실패는 OFFLINE으로 격리한다', async () => {
  const manager = { listHosts: () => [host, { ...host, alias: 'local', host: '192.168.0.11' }] };
  const service = new SystemService({ sshManager: manager, cacheTtlMs: 10000 });
  let calls = 0;
  service.collectRemote = async (item) => { calls++; if (item.alias === 'local') throw new Error('timeout'); return service.parse(item, remoteOutput); };
  const first = await service.getOverview(1), second = await service.getOverview(1);
  assert.equal(calls, 2);
  assert.equal(first.servers[1].online, false);
  assert.equal(first.servers[1].severity, 'OFFLINE');
  assert.equal(first.severity, 'OFFLINE');
  assert.match(first.servers[1].error, /timeout/);
  assert.strictEqual(first.servers[0], second.servers[0]);
});

test('활성 등록 서버만 조회하고 설정된 동시성만큼 병렬 수집한다', async () => {
  const hosts = [
    { ...host, alias: 'dev' },
    { ...host, alias: 'local' },
    { ...host, alias: 'disabled', enabled: 0 }
  ];
  let includeDisabled;
  const manager = {
    listHosts: (_userId, options) => {
      includeDisabled = options.includeDisabled;
      return hosts.filter((item) => item.enabled);
    }
  };
  const service = new SystemService({ sshManager: manager, concurrency: 2 });
  let active = 0, maxActive = 0;
  service.collectRemote = async (item) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return service.parse(item, remoteOutput);
  };

  const result = await service.getOverview(1);
  assert.equal(includeDisabled, false);
  assert.deepEqual(result.servers.map((item) => item.alias), ['dev', 'local']);
  assert.equal(maxActive, 2);
});

test('원격 수집은 SSH registry alias와 강제 timeout을 사용한다', async () => {
  let invocation;
  const execFile = async (...args) => {
    invocation = args;
    return { stdout: remoteOutput, stderr: '' };
  };
  const service = new SystemService({ execFile, timeoutMs: 4500 });

  const snapshot = await service.collectRemote(host);
  assert.equal(snapshot.online, true);
  assert.equal(invocation[0], 'ssh');
  assert.deepEqual(invocation[1].slice(0, 6), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'dev', invocation[1][5]]);
  assert.match(invocation[1][5], /^printf %s [A-Za-z0-9+/=]+ \| base64 -d \| sh$/);
  assert.equal(invocation[2].timeout, 6500);
});

test('전체 요약과 서버 상세을 구분해 표시한다', () => {
  const server = new SystemService().parse(host, remoteOutput);
  const overview = renderOverview({ checkedAt: '2026-09-01T00:00:00.000Z', severity: 'OK', servers: [server] });
  const detail = renderSystem(server);
  assert.match(overview, /`\[dev\]`/);
  assert.match(overview, /Docker 2 running/);
  assert.match(overview, /RAM \[600B\/1000B\] · 60\.0%/);
  assert.match(overview, /온도 43\.8°C/);
  assert.equal((overview.match(/OK/g) || []).length, 1);
  assert.match(detail, /Overall: OK/);
  assert.match(detail, /\/\+\/home\/dev/);
});

test('Docker가 없는 서버는 장애가 아니라 N/A로 표시한다', () => {
  const service = new SystemService();
  const server = service.parse({ ...host, alias: 'local' }, remoteOutput.replace(/DOCKER[\s\S]+$/, 'DOCKER\tnot_installed'));
  assert.equal(server.docker.installed, false);
  assert.match(renderSystem(server, 'docker'), /N\/A/);
});

test('Telegram callback data는 최대 길이 alias에서도 64 byte를 넘지 않는다', () => {
  const alias = 'a'.repeat(48);
  const buttons = [...overviewKeyboard([{ alias, severity: 'OK' }]), ...detailKeyboard(alias, 'overview')].flat();
  assert.ok(buttons.every((button) => Buffer.byteLength(button.callback_data) <= 64));
});

test('/system은 전체 요약, /system alias는 서버 상세를 조회한다', async () => {
  const server = new SystemService().parse(host, remoteOutput);
  const calls = [];
  const service = {
    getOverview: async (userId, options) => { calls.push(['overview', userId, options.force]); return { checkedAt: server.checkedAt, severity: 'OK', servers: [server] }; },
    getServer: async (userId, alias, options) => { calls.push(['server', userId, alias, options.force]); return server; }
  };
  let messageId = 0;
  const bot = {
    sendMessage: async (chatId) => ({ chat: { id: chatId }, message_id: ++messageId }),
    editMessageText: async () => {},
    answerCallbackQuery: async () => {}
  };
  const msg = { chat: { id: 10 }, from: { id: 20 } };
  await handleSystemCommand(bot, msg, '', service);
  await handleSystemCommand(bot, msg, 'dev', service);
  await handleSystemCallback(bot, { id: 'q', data: 'system_r:dev:c', from: { id: 20 }, message: { chat: { id: 10 }, message_id: 1 } }, service);
  assert.deepEqual(calls, [['overview', 20, false], ['server', 20, 'dev', false], ['server', 20, 'dev', true]]);
});
