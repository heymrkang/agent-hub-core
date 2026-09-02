import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { PreviewCleanup } from '../../src/preview/preview-cleanup.js';
import { PreviewManager } from '../../src/preview/preview-manager.js';
import { PreviewRegistry } from '../../src/preview/preview-registry.js';
import { PreviewRouteService } from '../../src/preview/preview-route-service.js';
import { PreviewRuntime } from '../../src/preview/preview-runtime.js';
import { PreviewRuntimeDetector } from '../../src/preview/runtime-detector.js';
import { PreviewSecurityPolicy } from '../../src/preview/preview-security-policy.js';

const repositoryRoot = path.resolve('.');
const fixturesRoot = path.join(repositoryRoot, 'tests', 'fixtures');
const migrationRoot = path.join(repositoryRoot, 'src', 'database', 'migrations');

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function copyFixture(name, target) {
  fs.cpSync(path.join(fixturesRoot, name), target, {
    recursive: true,
    filter: (source) => !['node_modules', 'dist'].includes(path.basename(source))
  });
}

function createRegistry() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const filename of fs.readdirSync(migrationRoot).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationRoot, filename), 'utf8'));
  }
  db.prepare('INSERT INTO users(id) VALUES(?)').run(1708);
  db.prepare("INSERT INTO sessions(id,user_id,title) VALUES('phase17-e2e',1708,'Phase 17 E2E')").run();
  return { db, registry: new PreviewRegistry({ db, domain: 'preview.test', maxActive: 3 }) };
}

function dependencies(registry, runtime, cleanupRuntime = runtime) {
  const securityPolicy = {
    prepareRuntime: (detected) => Object.freeze({
      ...detected,
      previewEnvironmentFile: null,
      previewEnvironment: Object.freeze({}),
      maskEnvironmentFiles: true
    }),
    verifyExternalAccess: async () => true
  };
  const manager = new PreviewManager({ registry, runtime, securityPolicy });
  const cleanup = new PreviewCleanup({
    registry,
    runtime: cleanupRuntime,
    manager,
    idleTimeoutHours: () => 24,
    consoleLogger: { log: () => {}, warn: () => {} }
  });
  return { manager, cleanup };
}

function waitForMariaDb(containerName, password, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execFileSync('docker', [
        'exec', '--env', `MYSQL_PWD=${password}`, containerName,
        'mariadb-admin', '--user=root', 'ping', '--silent'
      ], { stdio: 'ignore', timeout: 5_000 });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw new Error('MariaDB fixture readiness timeout');
}

function requestInContainer(containerId, port, method, requestPath, body = null) {
  const script = [
    "const [port,method,path,body]=process.argv.slice(1)",
    "const options={method,headers:{accept:'application/json'}}",
    "if(body!==''){options.headers['content-type']='application/json';options.body=body}",
    "fetch(`http://127.0.0.1:${port}${path}`,options).then(async response=>({status:response.status,body:await response.json()})).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exit(1)})"
  ].join(';');
  return JSON.parse(execFileSync('docker', [
    'exec', containerId, 'node', '-e', script,
    String(port), method, requestPath, body ? JSON.stringify(body) : ''
  ], { encoding: 'utf8', timeout: 10_000 }));
}

test('NestJS Backend Preview Docker lifecycle과 Core 재시작 복구', {
  skip: !dockerAvailable(),
  timeout: 240_000
}, async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(repositoryRoot, 'tests', '.phase17-e2e-'));
  const { db, registry } = createRegistry();
  const runtime = new PreviewRuntime();
  const createdContainerIds = new Set();
  const isCreatedContainer = (candidate) => [...createdContainerIds].some(
    (created) => created === candidate || created.startsWith(candidate) || candidate.startsWith(created)
  );
  const cleanupRuntime = new Proxy(runtime, {
    get(target, property) {
      if (property === 'listManaged') {
        return async (options) => (await target.listManaged(options)).filter(isCreatedContainer);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  try {
    const openapiPath = path.join(temporaryRoot, 'nest-openapi');
    const noOpenapiPath = path.join(temporaryRoot, 'nest-no-openapi');
    copyFixture('nest-openapi', openapiPath);
    copyFixture('nest-no-openapi', noOpenapiPath);
    const detector = new PreviewRuntimeDetector({ developmentRoot: temporaryRoot });
    const firstService = dependencies(registry, runtime, cleanupRuntime);

    const openapiRuntime = detector.detect({ workspacePath: openapiPath });
    assert.equal(openapiRuntime.runtimeType, 'BACKEND_API');
    assert.equal(openapiRuntime.framework, 'NESTJS');
    assert.equal(openapiRuntime.startScript, 'start:dev');
    let openapi = await firstService.manager.start({ sessionId: 'phase17-e2e', detectedRuntime: openapiRuntime });
    createdContainerIds.add(openapi.container_id);
    assert.equal(openapi.status, 'RUNNING');
    assert.equal(openapi.openapi_ui_path, '/docs');
    assert.equal(openapi.openapi_json_path, '/docs-json');
    assert.equal(openapi.health_path, '/health');
    assert.equal((await runtime.probeHttp(openapi.container_id, { port: openapi.port, path: '/health', maxBodyBytes: 4096 })).statusCode, 200);
    assert.equal((await runtime.probeHttp(openapi.container_id, { port: openapi.port, path: '/docs-json', maxBodyBytes: 4096 })).statusCode, 200);
    assert.equal(new PreviewRouteService({ registry }).resolve(openapi.public_hostname).previewId, openapi.id);

    openapi = await firstService.manager.restart(openapi.id);
    assert.equal(openapi.status, 'RUNNING');
    assert.equal(openapi.openapi_json_path, '/docs-json');

    db.prepare(`
      UPDATE previews
      SET status='STARTING',port=NULL,openapi_ui_path=NULL,openapi_json_path=NULL,health_path=NULL
      WHERE id=?
    `).run(openapi.id);
    const recoveredService = dependencies(registry, runtime, cleanupRuntime);
    const recovery = await recoveredService.cleanup.startupReconcile();
    openapi = registry.require(openapi.id);
    assert.equal(recovery.recovered, 1);
    assert.equal(openapi.status, 'RUNNING');
    assert.equal(openapi.openapi_json_path, '/docs-json');
    assert.equal(openapi.health_path, '/health');

    await recoveredService.manager.stop(openapi.id);
    assert.equal(registry.require(openapi.id).status, 'STOPPED');
    assert.throws(
      () => new PreviewRouteService({ registry }).resolve(openapi.public_hostname),
      (error) => error.code === 'UNAVAILABLE'
    );

    const noOpenapiRuntime = detector.detect({ workspacePath: noOpenapiPath });
    let noOpenapi = await recoveredService.manager.start({ sessionId: 'phase17-e2e', detectedRuntime: noOpenapiRuntime });
    createdContainerIds.add(noOpenapi.container_id);
    assert.equal(noOpenapi.status, 'RUNNING');
    assert.equal(noOpenapi.openapi_ui_path, null);
    assert.equal(noOpenapi.openapi_json_path, null);
    assert.equal(noOpenapi.health_path, '/health');

    db.prepare("UPDATE previews SET last_activity_at='2020-01-01 00:00:00' WHERE id=?").run(noOpenapi.id);
    const sweep = await recoveredService.cleanup.sweep({ now: new Date('2026-09-01T00:00:00Z') });
    noOpenapi = registry.require(noOpenapi.id);
    assert.equal(sweep.expired, 1);
    assert.equal(noOpenapi.status, 'EXPIRED');
    assert.throws(
      () => new PreviewRouteService({ registry }).resolve(noOpenapi.public_hostname),
      (error) => error.code === 'UNAVAILABLE'
    );

    const remaining = await cleanupRuntime.listManaged({ all: true });
    assert.deepEqual(remaining, []);
  } finally {
    for (const containerId of createdContainerIds) {
      try { await runtime.remove(containerId, { force: true }); } catch {}
    }
    db.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('NestJS Backend Preview가 격리된 MariaDB에 CRUD를 반영하고 재시작 후 유지한다', {
  skip: !dockerAvailable(),
  timeout: 300_000
}, async () => {
  const suffix = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const databaseContainer = `agent-hub-phase17-mariadb-${suffix}`;
  const databaseHost = `phase17-mariadb-${suffix}`;
  const databaseName = 'agent_hub_phase17_dev';
  const databaseUser = 'phase17_preview';
  const databasePassword = crypto.randomBytes(24).toString('hex');
  const rootPassword = crypto.randomBytes(24).toString('hex');
  const databaseUrl = `mariadb://${databaseUser}:${databasePassword}@${databaseHost}/${databaseName}`;
  const temporaryRoot = fs.mkdtempSync(path.join(repositoryRoot, 'tests', '.phase17-mariadb-e2e-'));
  const { db, registry } = createRegistry();
  const runtime = new PreviewRuntime();
  let preview = null;

  try {
    await runtime.ensureNetwork();
    execFileSync('docker', [
      'run', '--detach', '--name', databaseContainer,
      '--network', 'agent-hub-preview', '--network-alias', databaseHost,
      '--env', `MARIADB_DATABASE=${databaseName}`,
      '--env', `MARIADB_USER=${databaseUser}`,
      '--env', `MARIADB_PASSWORD=${databasePassword}`,
      '--env', `MARIADB_ROOT_PASSWORD=${rootPassword}`,
      'mariadb:11.4'
    ], { stdio: 'ignore', timeout: 180_000 });
    waitForMariaDb(databaseContainer, rootPassword);

    const projectPath = path.join(temporaryRoot, 'nest-openapi');
    copyFixture('nest-openapi', projectPath);
    fs.writeFileSync(path.join(projectPath, '.env.preview'), `DATABASE_URL=${databaseUrl}\n`);
    const detectedRuntime = new PreviewRuntimeDetector({ developmentRoot: temporaryRoot }).detect({ workspacePath: projectPath });
    const securityPolicy = new PreviewSecurityPolicy({
      env: {
        PREVIEW_TUNNEL_ONLY: 'true',
        PREVIEW_CLOUDFLARE_TEAM_DOMAIN: 'https://phase17.cloudflareaccess.com',
        PREVIEW_CLOUDFLARE_ACCESS_AUD: 'a'.repeat(32)
      },
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: 'https://phase17.cloudflareaccess.com/cdn-cgi/access/login' }
      })
    });
    const manager = new PreviewManager({ registry, runtime, securityPolicy });

    preview = await manager.start({ sessionId: 'phase17-e2e', detectedRuntime });
    assert.equal(preview.status, 'RUNNING');
    assert.equal(preview.access_verified, true);

    let response = requestInContainer(preview.container_id, preview.port, 'POST', '/items', { name: 'mariadb-alpha' });
    assert.equal(response.status, 201);
    assert.equal(response.body.name, 'mariadb-alpha');

    const persisted = execFileSync('docker', [
      'exec', '--env', `MYSQL_PWD=${databasePassword}`, databaseContainer,
      'mariadb', `--user=${databaseUser}`, `--database=${databaseName}`,
      '--batch', '--skip-column-names',
      '--execute', 'SELECT name FROM phase17_preview_items ORDER BY id LIMIT 1'
    ], { encoding: 'utf8', timeout: 10_000 }).trim();
    assert.equal(persisted, 'mariadb-alpha');

    preview = await manager.restart(preview.id);
    response = requestInContainer(preview.container_id, preview.port, 'GET', '/items');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, [{ id: 1, name: 'mariadb-alpha' }]);

    const logs = await manager.logs(preview.id);
    assert.doesNotMatch(logs, new RegExp(databasePassword));
    assert.doesNotMatch(logs, /mariadb:\/\//i);

    await manager.stop(preview.id);
    preview = null;
  } finally {
    if (preview?.container_id) {
      try { await runtime.remove(preview.container_id, { force: true }); } catch {}
    }
    try { execFileSync('docker', ['rm', '--force', databaseContainer], { stdio: 'ignore', timeout: 10_000 }); } catch {}
    db.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
