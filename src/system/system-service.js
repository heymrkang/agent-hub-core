import { execFile } from 'child_process';
import { promisify } from 'util';
import { SshManager } from '../ssh/ssh-manager.js';
import { RESOURCE_THRESHOLDS, cpuSeverity, usageSeverity, worstSeverity } from './resource-severity.js';

const execFileAsync = promisify(execFile);
export const REMOTE_SCRIPT = String.raw`set -u
one_line() { printf '%s' "$1" | tr '\n\t' '  '; }
printf 'HOST\t'; one_line "$(hostname 2>/dev/null || true)"; printf '\t'; one_line "$(. /etc/os-release 2>/dev/null; printf '%s' "\${PRETTY_NAME:-\${NAME:-unknown}}")"; printf '\t%s\t%s\t%s\n' "$(uname -r)" "$(uname -m)" "$(cut -d. -f1 /proc/uptime)"
printf 'CPU1\t%s\n' "$(sed -n '1p' /proc/stat)"
sleep 0.2
printf 'CPU2\t%s\n' "$(sed -n '1p' /proc/stat)"
printf 'LOAD\t%s\n' "$(cat /proc/loadavg)"
printf 'CORES\t%s\n' "$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ { printf "MEM\t%s\t%s\n", $1, $2 * 1024 }' /proc/meminfo
disk_paths="/"
for p in /data /home/dev /mnt/storage; do [ -e "$p" ] && disk_paths="$disk_paths $p"; done
df -P -B1 $disk_paths 2>/dev/null | awk 'NR > 1 { printf "DISK\t%s\t%s\t%s\t%s\t%s\t%s\n", $1,$2,$3,$4,$5,$6 }'
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
  constructor({ sshManager = SshManager, cacheTtlMs = 10000, refreshDebounceMs = 3000, timeoutMs = 10000, concurrency = 4 } = {}) {
    this.sshManager = sshManager; this.cacheTtlMs = cacheTtlMs; this.refreshDebounceMs = refreshDebounceMs;
    this.timeoutMs = timeoutMs; this.concurrency = concurrency; this.cache = new Map(); this.inFlight = new Map();
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
    const promise = this.collectRemote(host).catch((error) => ({ alias: host.alias, address: host.host, checkedAt: new Date().toISOString(), online: false, severity: 'UNKNOWN', error: String(error.stderr || error.stdout || error.message || error).trim().slice(0, 500) }))
      .then((value) => { this.cache.set(key, { at: Date.now(), value }); return value; }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise); return promise;
  }

  async collectRemote(host) {
    const encoded = Buffer.from(REMOTE_SCRIPT).toString('base64');
    const { stdout } = await execFileAsync('ssh', ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${Math.max(1, Math.ceil(this.timeoutMs / 1000))}`, host.alias, `printf %s ${encoded} | base64 -d | sh`], { timeout: this.timeoutMs + 2000, maxBuffer: 2 * 1024 * 1024 });
    return this.parse(host, stdout);
  }

  parse(host, output) {
    const rows = String(output).trim().split('\n').map((line) => line.split('\t')), first = (name) => rows.find((row) => row[0] === name);
    const hostRow = first('HOST'); if (!hostRow) throw new Error('원격 시스템 응답 형식이 올바르지 않습니다.');
    const c1 = cpuLine(first('CPU1')?.[1]), c2 = cpuLine(first('CPU2')?.[1]), totalDelta = c1 && c2 ? c2.total - c1.total : 0;
    const usagePercent = totalDelta > 0 ? (1 - (c2.idle - c1.idle) / totalDelta) * 100 : null;
    const load = first('LOAD')?.[1]?.split(/\s+/).map(Number) || [], cores = number(first('CORES')?.[1]);
    const cpu = { available: Number.isFinite(usagePercent), usagePercent, cores, load1: load[0], load5: load[1], load15: load[2] }; cpu.severity = cpuSeverity(cpu);
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
