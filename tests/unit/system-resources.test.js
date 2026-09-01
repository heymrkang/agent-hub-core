import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuSeverity, usageSeverity, RESOURCE_THRESHOLDS } from '../../src/system/resource-severity.js';
import { SystemService } from '../../src/system/system-service.js';
import { renderOverview, renderSystem } from '../../src/telegram/commands/system.js';

const host = { user_id: 1, alias: 'dev', host: '192.168.0.10', enabled: 1 };
const remoteOutput = `HOST\tdev-host\tUbuntu 24.04 LTS\t6.8.0\tx86_64\t86400
CPU1\tcpu  100 0 100 800 0 0 0 0 0 0
CPU2\tcpu  110 0 110 880 0 0 0 0 0 0
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
  assert.match(first.servers[1].error, /timeout/);
  assert.strictEqual(first.servers[0], second.servers[0]);
});

test('전체 요약과 서버 상세을 구분해 표시한다', () => {
  const server = new SystemService().parse(host, remoteOutput);
  const overview = renderOverview({ checkedAt: '2026-09-01T00:00:00.000Z', severity: 'OK', servers: [server] });
  const detail = renderSystem(server);
  assert.match(overview, /dev/);
  assert.match(overview, /Docker 2 running/);
  assert.match(detail, /Overall: OK/);
  assert.match(detail, /\/\+\/home\/dev/);
});

test('Docker가 없는 서버는 장애가 아니라 N/A로 표시한다', () => {
  const service = new SystemService();
  const server = service.parse({ ...host, alias: 'local' }, remoteOutput.replace(/DOCKER[\s\S]+$/, 'DOCKER\tnot_installed'));
  assert.equal(server.docker.installed, false);
  assert.match(renderSystem(server, 'docker'), /N\/A/);
});
