import http from 'http';
import fs from 'fs';
import { getDb } from '../database/index.js';

function coreSnapshot() {
  const checks = [];
  let unhealthy = false;
  try {
    const row = getDb().prepare('PRAGMA quick_check').get();
    const value = Object.values(row || {})[0];
    const ok = value === 'ok'; unhealthy ||= !ok;
    checks.push({ name: 'database', ok, detail: ok ? 'SQLite quick_check OK' : String(value || 'failed') });
  } catch (error) { unhealthy = true; checks.push({ name: 'database', ok: false, detail: error.message }); }

  const paths = [process.env.DATA_DIR || '/data', process.env.WORKSPACE_DIR || '/workspace'];
  for (const p of paths) {
    try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); checks.push({ name: `storage:${p}`, ok: true }); }
    catch (error) { unhealthy = true; checks.push({ name: `storage:${p}`, ok: false, detail: error.message }); }
  }

  try {
    getDb().prepare('SELECT 1 FROM schedules LIMIT 1').get();
    checks.push({ name: 'scheduler-schema', ok: true });
  } catch (error) { unhealthy = true; checks.push({ name: 'scheduler-schema', ok: false, detail: error.message }); }
  return { status: unhealthy ? 'unhealthy' : 'healthy', checks, checkedAt: new Date().toISOString() };
}

export function startHealthServer() {
  const host = process.env.HEALTH_HOST || '127.0.0.1';
  const port = Number(process.env.HEALTH_PORT || 8787);
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' })); return; }
    const snapshot = coreSnapshot();
    res.writeHead(snapshot.status === 'healthy' ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(snapshot));
  });
  server.listen(port, host, () => console.log(`[Health] internal endpoint 시작: http://${host}:${port}/health`));
  server.on('error', (error) => console.error(`[Health] server 오류: ${error.message}`));
  return server;
}
