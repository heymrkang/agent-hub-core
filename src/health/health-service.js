import fs from 'fs';
import { getDb } from '../database/index.js';
import { providerManager } from '../providers/provider-manager.js';
import { modelCatalog } from '../providers/model-catalog.js';
import { DockerClient } from '../docker/docker-client.js';
import { GitManager } from '../git/git-manager.js';
import { SshManager } from '../ssh/ssh-manager.js';
import { queueManager } from '../jobs/queue-manager.js';

export const HealthState = Object.freeze({ HEALTHY: 'HEALTHY', DEGRADED: 'DEGRADED', ERROR: 'ERROR' });
const rank = { HEALTHY: 0, DEGRADED: 1, ERROR: 2 };
function check(name, state, detail, meta = null) { return { name, state, detail, meta }; }
function worst(checks) { return checks.reduce((s, c) => rank[c.state] > rank[s] ? c.state : s, HealthState.HEALTHY); }

export class HealthService {
  static async getSnapshot() {
    const checks = [];
    checks.push(this.database());
    checks.push(this.scheduler());
    checks.push(...await this.providers());
    checks.push(...this.modelCatalog());
    checks.push(await this.docker());
    checks.push(await this.git());
    checks.push(this.ssh());
    checks.push(this.storage());
    checks.push(this.jobs());
    return { state: worst(checks), checkedAt: new Date().toISOString(), checks };
  }

  static database() {
    try { const row = getDb().prepare('PRAGMA quick_check').get(); const value = Object.values(row || {})[0]; return check('Database', value === 'ok' ? HealthState.HEALTHY : HealthState.ERROR, value === 'ok' ? 'SQLite quick_check OK' : String(value || 'quick_check failed')); }
    catch (e) { return check('Database', HealthState.ERROR, e.message); }
  }

  static scheduler() {
    try {
      const db = getDb();
      const enabled = db.prepare('SELECT COUNT(*) AS c FROM schedules WHERE enabled=1').get().c;
      const failed = db.prepare("SELECT COUNT(*) AS c FROM schedule_runs WHERE status='FAILED' AND created_at >= datetime('now','-24 hours')").get().c;
      const running = db.prepare("SELECT COUNT(*) AS c FROM schedule_runs WHERE status='RUNNING'").get().c;
      return check('Scheduler', failed > 0 ? HealthState.DEGRADED : HealthState.HEALTHY, `enabled=${enabled}, running=${running}, failed24h=${failed}`);
    } catch (e) { return check('Scheduler', HealthState.ERROR, e.message); }
  }

  static async providers() {
    try {
      return (await providerManager.getProvidersStatus()).map((p) => {
        if (!p.healthy) return check(`Provider:${p.name}`, HealthState.DEGRADED, `CLI ERROR${p.version ? ` / ${p.version}` : ''}`);
        if (p.authenticated === false) return check(`Provider:${p.name}`, HealthState.DEGRADED, `CLI OK / AUTH REQUIRED${p.version ? ` / ${p.version}` : ''}`);
        const authLabel = p.authenticated === true ? 'AUTH OK' : 'AUTH PRESENT';
        return check(`Provider:${p.name}`, HealthState.HEALTHY, `CLI OK / ${authLabel}${p.version ? ` / ${p.version}` : ''}`);
      });
    } catch (e) { return [check('Providers', HealthState.DEGRADED, e.message)]; }
  }

  static modelCatalog() {
    return providerManager.listProviderNames().map((provider) => {
      try { const state = modelCatalog.getCacheState(provider); const models = modelCatalog.getModels(provider); const health = state.status === 'FRESH' ? HealthState.HEALTHY : HealthState.DEGRADED; return check(`Models:${provider}`, health, `${state.status} / ${models.length} models`); }
      catch (e) { return check(`Models:${provider}`, HealthState.DEGRADED, e.message); }
    });
  }

  static async docker() { const d = await DockerClient.getSummary(); return check('Docker', d.available ? HealthState.HEALTHY : HealthState.DEGRADED, d.available ? `daemon ${d.serverVersion || 'unknown'} / running=${d.running ?? '?'}` : (d.error || 'daemon unavailable')); }
  static async git() { try { const g = await GitManager.status(); const state = !g.git.available || (g.tokenConfigured && !g.authenticated) ? HealthState.DEGRADED : HealthState.HEALTHY; return check('Git/GitHub', state, `git=${g.git.available ? 'OK' : 'ERROR'} / gh=${g.gh.available ? 'OK' : 'N/A'} / auth=${g.authState}`); } catch (e) { return check('Git/GitHub', HealthState.DEGRADED, e.message); } }
  static ssh() { try { const s = SshManager.getSummary(); return check('SSH', s.enabled > 0 && s.keys === 0 ? HealthState.DEGRADED : HealthState.HEALTHY, `hosts=${s.enabled}/${s.total} enabled / keys=${s.keys}`); } catch (e) { return check('SSH', HealthState.DEGRADED, e.message); } }
  static storage() {
    const paths = [process.env.DATA_DIR || '/data', process.env.WORKSPACE_DIR || '/workspace'];
    const failures = [];
    for (const p of paths) { try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); } catch { failures.push(p); } }
    return check('Storage', failures.length ? HealthState.ERROR : HealthState.HEALTHY, failures.length ? `read/write unavailable: ${failures.join(', ')}` : `read/write OK: ${paths.join(', ')}`);
  }
  static jobs() { try { const s = queueManager.getQueueStats(); return check('Jobs', s.totalQueued > 20 ? HealthState.DEGRADED : HealthState.HEALTHY, `active=${s.activeExecutionsCount}, queued=${s.totalQueued}`); } catch (e) { return check('Jobs', HealthState.ERROR, e.message); } }
}
