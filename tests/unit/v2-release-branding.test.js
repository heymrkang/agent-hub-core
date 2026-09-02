import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const startup = fs.readFileSync('src/index.js', 'utf-8');
const telegram = fs.readFileSync('src/telegram.js', 'utf-8');
const readme = fs.readFileSync('README.md', 'utf-8');
const bridgePlan = fs.readFileSync('.plan/V1_V2_NATIVE_SESSION_BRIDGE.md', 'utf-8');

test('Agent Hub Core release metadata is V2 / 2.0.0', () => {
  assert.equal(packageJson.version, '2.0.0');
  assert.match(packageJson.description, /Agent Hub Core V2/);
});

test('runtime and user-facing help use V2 branding', () => {
  assert.match(startup, /Agent Hub Core V2 · 2\.0\.0/);
  assert.match(telegram, /Agent Hub Core V2 · 2\.0\.0/);
  assert.doesNotMatch(startup, /Agent Hub Core V1/);
  assert.doesNotMatch(telegram, /Agent Hub Core V1/);
});

test('README and migration record identify V2 as current DONE baseline', () => {
  assert.match(readme, /^# Agent Hub Core V2/m);
  assert.match(readme, /Current release: 2\.0\.0/);
  assert.match(bridgePlan, /`DONE — Agent Hub Core V2 \/ 2\.0\.0 promotion approved/);
  assert.match(bridgePlan, /1~18 = PASS/);
  assert.match(bridgePlan, /Provider Rules Memory live validation succeeds/);
});
