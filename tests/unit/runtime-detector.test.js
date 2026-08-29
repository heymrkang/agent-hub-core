import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreviewRuntimeDetector, RuntimeDetectionError } from '../../src/preview/runtime-detector.js';

const fixtureRoot = fs.realpathSync(path.resolve('tests/fixtures/preview'));

function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-preview-'));
  const project = path.join(root, 'app');
  fs.mkdirSync(project);
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(project, name), contents);
  return { root, project };
}

function expectCode(code) {
  return (error) => error instanceof RuntimeDetectionError && error.code === code;
}

test('Next.js npm 프로젝트의 dev runtime을 감지한다', () => {
  const detector = new PreviewRuntimeDetector({ developmentRoot: fixtureRoot });
  const result = detector.detect({ workspacePath: path.join(fixtureRoot, 'next-app') });
  assert.equal(result.projectName, 'preview-next-app');
  assert.equal(result.packageManager, 'npm');
  assert.deepEqual(result.command, { executable: 'npm', args: ['run', 'dev'], source: 'detected' });
  assert.equal(result.devScript, 'next dev');
});

test('Vite pnpm 프로젝트의 dev runtime을 감지한다', () => {
  const detector = new PreviewRuntimeDetector({ developmentRoot: fixtureRoot });
  const result = detector.detect({ workspacePath: path.join(fixtureRoot, 'vite-app') });
  assert.equal(result.packageManager, 'pnpm');
  assert.deepEqual(result.command, { executable: 'pnpm', args: ['run', 'dev'], source: 'detected' });
  assert.equal(result.devScript, 'vite');
});

test('명령 override를 셸 없는 실행 구조로 반환한다', () => {
  const detector = new PreviewRuntimeDetector({ developmentRoot: fixtureRoot });
  const result = detector.detect({ workspacePath: path.join(fixtureRoot, 'vite-app'), commandOverride: ['pnpm', 'exec', 'vite', '--host', '0.0.0.0'] });
  assert.deepEqual(result.command, { executable: 'pnpm', args: ['exec', 'vite', '--host', '0.0.0.0'], source: 'override' });
});

test('development root 외부 경로와 symlink 탈출을 차단한다', () => {
  const { root, project } = makeProject({ 'package.json': '{"scripts":{"dev":"vite"}}', 'yarn.lock': '' });
  const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-allowed-'));
  const link = path.join(allowedRoot, 'escape');
  fs.symlinkSync(project, link, 'dir');
  try {
    const detector = new PreviewRuntimeDetector({ developmentRoot: allowedRoot });
    assert.throws(() => detector.detect({ workspacePath: project }), expectCode('WORKSPACE_OUTSIDE_ROOT'));
    assert.throws(() => detector.detect({ workspacePath: link }), expectCode('WORKSPACE_OUTSIDE_ROOT'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(allowedRoot, { recursive: true, force: true });
  }
});

test('모호한 lockfile과 누락된 dev script를 명확히 거부한다', () => {
  const ambiguous = makeProject({ 'package.json': '{"scripts":{"dev":"vite"}}', 'package-lock.json': '{}', 'yarn.lock': '' });
  const noScript = makeProject({ 'package.json': '{"name":"app"}', 'package-lock.json': '{}' });
  try {
    assert.throws(() => new PreviewRuntimeDetector({ developmentRoot: ambiguous.root }).detect({ workspacePath: ambiguous.project }), expectCode('AMBIGUOUS_PACKAGE_MANAGER'));
    assert.throws(() => new PreviewRuntimeDetector({ developmentRoot: noScript.root }).detect({ workspacePath: noScript.project }), expectCode('DEV_SCRIPT_NOT_FOUND'));
  } finally {
    fs.rmSync(ambiguous.root, { recursive: true, force: true });
    fs.rmSync(noScript.root, { recursive: true, force: true });
  }
});

test('dev script가 없어도 유효한 override는 허용한다', () => {
  const fixture = makeProject({ 'package.json': '{"name":"custom-app"}', 'package-lock.json': '{}' });
  try {
    const result = new PreviewRuntimeDetector({ developmentRoot: fixture.root }).detect({ workspacePath: fixture.project, commandOverride: ['npm', 'start'] });
    assert.equal(result.devScript, null);
    assert.equal(result.command.source, 'override');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
