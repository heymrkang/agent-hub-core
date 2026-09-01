import { execFile } from 'child_process';
import { promisify } from 'util';
import { SshManager } from '../ssh/ssh-manager.js';
import { RESOURCE_THRESHOLDS, cpuSeverity, usageSeverity, worstSeverity } from './resource-severity.js';

const execFileAsync = promisify(execFile);
export const REMOTE_SCRIPT = String.raw`set -u
one_line() { printf '%s' "$1" | tr '\n\t' '  '; }
os_name="$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null | sed 's/^"//;s/"$//' | head -1)"
[ -n "$os_name" ] || os_name="$(sed -n 's/^NAME=//p' /etc/os-release 2>/dev/null | sed 's/^"//;s/"$//' | head -1)"
[ -n "$os_name" ] || os_name=unknown
printf 'HOST\t'; one_line "$(hostname 2>/dev/null || true)"; printf '\t'; one_line "$os_name"; printf '\t%s\t%s\t%s\n' "$(uname -r)" "$(uname -m)" "$(cut -d. -f1 /proc/uptime)"
# CPU/Docker 조회가 만드는 열보다 먼저 읽고, SSH 접속 직후 값은 버린다.
for sensor in /sys/class/hwmon/hwmon*/temp*_input /sys/class/thermal/thermal_zone*/temp; do
  [ -r "$sensor" ] && cat "$sensor" >/dev/null 2>&1 || true
done
for temp_sample in 1 2 3; do
  sleep 0.5
  for sensor in /sys/class/hwmon/hwmon*/temp*_input /sys/class/thermal/thermal_zone*/temp; do
    [ -r "$sensor" ] || continue
    value="$(cat "$sensor" 2>/dev/null || true)"
    case "$value" in ''|*[!0-9-]*) continue ;; esac
    label=""
    case "$sensor" in
      */thermal_zone*/temp) label="$(cat "$(dirname "$sensor")/type" 2>/dev/null || true)" ;;
      *_input) label="$(cat "$(printf '%s' "$sensor" | sed 's/_input$/_label/')" 2>/dev/null || true)" ;;
    esac
    printf 'TEMP\t'; one_line "$label"; printf '\t%s\n' "$value"
  done
done
printf 'CPU\t%s\n' "$(sed -n '1p' /proc/stat)"
for sample in 1 2 3 4; do
  sleep 0.5
  printf 'CPU\t%s\n' "$(sed -n '1p' /proc/stat)"
done
printf 'LOAD\t%s\n' "$(cat /proc/loadavg)"
printf 'CORES\t%s\n' "$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ { printf "MEM\t%s\t%s\n", $1, $2 * 1024 }' /proc/meminfo
# 실제 블록 디바이스에 마운트된 모든 로컬 디스크를 수집한다. Docker overlay,
# tmpfs 같은 가상 filesystem은 제외하고 외장 HDD/SSD는 마운트 경로와 함께 자동 반영한다.
if command -v findmnt >/dev/null 2>&1; then
  findmnt -rn -b -o SOURCE,SIZE,USED,AVAIL,USE%,TARGET 2>/dev/null | awk '$1 ~ /^\/dev\// { printf "DISK\t%s\t%s\t%s\t%s\t%s\t%s\n", $1,$2,$3,$4,$5,$6 }'
else
  df -P -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | awk 'NR > 1 && $1 ~ /^\/dev\// { printf "DISK\t%s\t%s\t%s\t%s\t%s\t%s\n", $1,$2,$3,$4,$5,$6 }'
fi
if ! command -v docker >/dev/null 2>&1; then printf 'DOCKER\tnot_installed\n'; exit 0; fi
if ! docker info >/dev/null 2>&1; then printf 'DOCKER\tunavailable\n'; exit 0; fi
printf 'DOCKER\tavailable\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(docker version --format '{{.Server.Version}}' 2>/dev/null)" \
  "$(docker ps -q | wc -l)" "$(docker ps -aq --filter status=exited | wc -l)" \
  "$(docker ps -aq --filter health=unhealthy | wc -l)" "$(docker ps -aq --filter status=restarting | wc -l)" \
  "$(docker images -q | sort -u | wc -l)"
target=""
for candidate in docker-agent-telegram agent-telegram; do
  if docker inspect "$candidate" >/dev/null 2>&1; then target="$candidate"; break; fi
done
if [ -z "$target" ]; then target="$(docker ps -aq --filter label=com.docker.compose.service=agent-telegram | head -1)"; fi
if [ -z "$target" ]; then printf 'RUNTIME\tnot_installed\n'; exit 0; fi
printf 'RUNTIME\tavailable\t%s\t%s\t%s\t%s\t%s\n' \
  "$(docker inspect --format '{{.Name}}' "$target")" "$(docker inspect --format '{{.State.Status}}' "$target")" \
  "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$target")" \
  "$(docker inspect --format '{{.RestartCount}}' "$target")" "$(docker inspect --format '{{.State.StartedAt}}' "$target")"
stats="$(docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' "$target" 2>/dev/null || true)"
[ -n "$stats" ] && printf 'STATS\t%s\n' "$stats"`;

function cpuLine(text) {
  const parts = String(text || '').trim().split(/\s+/).slice(1).map(Number);
  if (!parts.length || parts.some((value) => !Number.isFinite(value))) return null;
  return { idle: (parts[3] || 0) + (parts[4] || 0), total: parts.reduce((sum, value) => sum + value, 0) };
}
const number = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };

export class SystemService {
  constructor({ sshManager = SshManager, execFile = execFileAsync, cacheTtlMs = 10000, refreshDebounceMs = 3000, timeoutMs = 10000, concurrency = 4 } = {}) {
    this.sshManager = sshManager; this.cacheTtlMs = cacheTtlMs; this.refreshDebounceMs = refreshDebounceMs;
    this.execFile = execFile; this.timeoutMs = timeoutMs; this.concurrency = Math.max(1, concurrency); this.cache = new Map(); this.inFlight = new Map();
  }

  async getOverview(userId, { force = false } = {}) {
    const hosts = this.sshManager.listHosts(userId, { includeDisabled: false });
    const snapshots = [];
    for (let i = 0; i < hosts.length; i += this.concurrency) snapshots.push(...await Promise.all(hosts.slice(i, i + this.concurrency).map((host) => this.getHostSnapshot(host, { force }))));
    return { checkedAt: new Date().toISOString(), servers: snapshots, severity: worstSeverity(snapshots.map((item) => item.severity)) };
  }

  async getServer(userId, alias, { force = false } = {}) {
    const host = this.sshManager.getHost(userId, alias);
    if (!host || !host.enabled) throw new Error(`활성 서버를 찾을 수 없습니다: ${alias}`);
    return this.getHostSnapshot(host, { force });
  }

  async getHostSnapshot(host, { force = false } = {}) {
    const key = `${host.user_id}:${host.alias}`, cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < (force ? this.refreshDebounceMs : this.cacheTtlMs)) return cached.value;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = this.collectRemote(host).catch((error) => ({ alias: host.alias, address: host.host, checkedAt: new Date().toISOString(), online: false, severity: 'OFFLINE', error: String(error.stderr || error.stdout || error.message || error).trim().slice(0, 500) }))
      .then((value) => { this.cache.set(key, { at: Date.now(), value }); return value; }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise); return promise;
  }

  async collectRemote(host) {
    const encoded = Buffer.from(REMOTE_SCRIPT).toString('base64');
    const { stdout } = await this.execFile('ssh', ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${Math.max(1, Math.ceil(this.timeoutMs / 1000))}`, host.alias, `printf %s ${encoded} | base64 -d | sh`], { timeout: this.timeoutMs + 2000, maxBuffer: 2 * 1024 * 1024 });
    return this.parse(host, stdout);
  }

  parse(host, output) {
    const rows = String(output).trim().split('\n').map((line) => line.split('\t')), first = (name) => rows.find((row) => row[0] === name);
    const hostRow = first('HOST'); if (!hostRow) throw new Error('원격 시스템 응답 형식이 올바르지 않습니다.');
    const cpuRows = rows.filter((row) => row[0] === 'CPU').map((row) => cpuLine(row[1])).filter(Boolean);
    if (!cpuRows.length) cpuRows.push(...['CPU1', 'CPU2'].map((name) => cpuLine(first(name)?.[1])).filter(Boolean));
    const cpuSamples = [];
    for (let i = 1; i < cpuRows.length; i++) {
      const totalDelta = cpuRows[i].total - cpuRows[i - 1].total;
      if (totalDelta > 0) cpuSamples.push((1 - (cpuRows[i].idle - cpuRows[i - 1].idle) / totalDelta) * 100);
    }
    const usagePercent = cpuSamples.length ? cpuSamples.reduce((sum, value) => sum + value, 0) / cpuSamples.length : null;
    const load = first('LOAD')?.[1]?.split(/\s+/).map(Number) || [], cores = number(first('CORES')?.[1]);
    const temperatureReadings = rows.filter((row) => row[0] === 'TEMP').map((row) => ({ label: row[1] || '', celsius: number(row[2]) / 1000 }))
      .filter((item) => Number.isFinite(item.celsius) && item.celsius > -20 && item.celsius < 150);
    const temperatureGroups = new Map();
    for (const reading of temperatureReadings) {
      const values = temperatureGroups.get(reading.label) || [];
      values.push(reading.celsius); temperatureGroups.set(reading.label, values);
    }
    const temperatures = [...temperatureGroups].map(([label, values]) => ({ label, celsius: values.reduce((sum, value) => sum + value, 0) / values.length }));
    const preferredTemperature = temperatures.find((item) => /package|tctl|cpu/i.test(item.label)) || temperatures.find((item) => /core/i.test(item.label)) || temperatures.sort((a, b) => b.celsius - a.celsius)[0];
    const cpu = { available: Number.isFinite(usagePercent), usagePercent, sampleCount: cpuSamples.length, temperatureCelsius: preferredTemperature?.celsius ?? null, cores, load1: load[0], load5: load[1], load15: load[2] }; cpu.severity = cpuSeverity(cpu);
    const mem = Object.fromEntries(rows.filter((row) => row[0] === 'MEM').map((row) => [row[1].replace(':', ''), number(row[2])]));
    const total = mem.MemTotal, available = mem.MemAvailable, used = total - available;
    const memory = { available: Number.isFinite(total), total, used, availableBytes: available, usagePercent: total > 0 ? used / total * 100 : null, swapTotal: mem.SwapTotal || 0, swapUsed: Math.max(0, (mem.SwapTotal || 0) - (mem.SwapFree || 0)) }; memory.severity = usageSeverity(memory.usagePercent, RESOURCE_THRESHOLDS.memory);
    const unique = new Map();
    for (const row of rows.filter((item) => item[0] === 'DISK')) {
      const key = `${row[1]}:${row[2]}`, path = row[6], existing = unique.get(key); if (existing) { if (!existing.paths.includes(path)) existing.paths.push(path); continue; }
      const percent = number(String(row[5]).replace('%', ''));
      unique.set(key, { filesystem: row[1], paths: [path], total: number(row[2]), used: number(row[3]), availableBytes: number(row[4]), usagePercent: percent, severity: usageSeverity(percent, RESOURCE_THRESHOLDS.disk) });
    }
    const disks = { available: unique.size > 0, items: [...unique.values()] }, dockerRow = first('DOCKER');
    let docker = { available: true, installed: false };
    if (dockerRow?.[1] === 'available') docker = { available: true, installed: true, serverVersion: dockerRow[2], running: number(dockerRow[3]), stopped: number(dockerRow[4]), unhealthy: number(dockerRow[5]), restarting: number(dockerRow[6]), images: number(dockerRow[7]) };
    else if (dockerRow?.[1] === 'unavailable') docker = { available: false, installed: true, error: 'Docker daemon 응답 없음' };
    const runtimeRow = first('RUNTIME'), statsRow = first('STATS');
    const runtime = runtimeRow?.[1] === 'available' ? { available: true, installed: true, name: runtimeRow[2]?.replace(/^\//, ''), state: runtimeRow[3], health: runtimeRow[4], restartCount: number(runtimeRow[5]), startedAt: runtimeRow[6], cpuPercent: statsRow?.[1], memoryUsage: statsRow?.[2], memoryPercent: statsRow?.[3] } : { available: true, installed: false };
    const dockerSeverity = !docker.installed ? null : (!docker.available ? 'UNKNOWN' : (docker.unhealthy || docker.restarting) ? 'WARN' : 'OK');
    const runtimeSeverity = !runtime.installed ? null : (runtime.health === 'unhealthy' ? 'CRITICAL' : 'OK');
    return { alias: host.alias, address: host.host, checkedAt: new Date().toISOString(), online: true, severity: worstSeverity([cpu.severity, memory.severity, ...disks.items.map((item) => item.severity), dockerSeverity, runtimeSeverity].filter(Boolean)), host: { available: true, hostname: hostRow[1], os: hostRow[2], kernel: hostRow[3], architecture: hostRow[4], uptimeSeconds: number(hostRow[5]) }, cpu, memory, disks, docker, runtime };
  }
}

export const systemService = new SystemService();
