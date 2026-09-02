const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

function startFixture() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('dist/main.js')], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`fixture start timeout\n${stdout}\n${stderr}`)), 10000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/FIXTURE_READY:(http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ child, baseUrl: match[1] });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`fixture exited with ${code}\n${stdout}\n${stderr}`));
    });
  });
}

test('Swagger 없이 health, CRUD, multipart, SSE를 제공한다', async (t) => {
  const { child, baseUrl } = await startFixture();
  t.after(() => child.kill('SIGTERM'));

  let response = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await response.json(), { status: 'ok' });

  response = await fetch(`${baseUrl}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'alpha' })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 1, name: 'alpha' });

  response = await fetch(`${baseUrl}/items/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'beta' })
  });
  assert.deepEqual(await response.json(), { id: 1, name: 'beta' });

  const form = new FormData();
  form.set('file', new Blob(['fixture-data'], { type: 'text/plain' }), 'fixture.txt');
  response = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
  assert.deepEqual(await response.json(), {
    originalName: 'fixture.txt',
    contentType: 'text/plain',
    size: 12
  });

  response = await fetch(`${baseUrl}/events`);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /"status":"ready"/);

  response = await fetch(`${baseUrl}/items/1`, { method: 'DELETE' });
  assert.deepEqual(await response.json(), { id: 1, name: 'beta' });
  response = await fetch(`${baseUrl}/items`);
  assert.deepEqual(await response.json(), []);

  response = await fetch(`${baseUrl}/docs`);
  assert.equal(response.status, 404);
});
