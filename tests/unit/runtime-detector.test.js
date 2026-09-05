import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreviewRuntimeDetector, RuntimeDetectionError } from '../../src/preview/runtime-detector.js';

const fixtureRoot = fs.realpathSync(path.resolve('tests/fixtures/preview'));
const allFixturesRoot = fs.realpathSync(path.resolve('tests/fixtures'));

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
  assert.equal(result.runtimeType, 'WEB');
  assert.equal(result.framework, 'NEXTJS');
});

test('Vite pnpm 프로젝트의 dev runtime을 감지한다', () => {
  const detector = new PreviewRuntimeDetector({ developmentRoot: fixtureRoot });
  const result = detector.detect({ workspacePath: path.join(fixtureRoot, 'vite-app') });
  assert.equal(result.packageManager, 'pnpm');
  assert.deepEqual(result.command, { executable: 'pnpm', args: ['run', 'dev'], source: 'detected' });
  assert.equal(result.devScript, 'vite');
  assert.equal(result.runtimeType, 'WEB');
  assert.equal(result.framework, 'VITE');
});

test('두 NestJS fixture를 BACKEND_API로 감지하고 start:dev를 선택한다', () => {
  const detector = new PreviewRuntimeDetector({ developmentRoot: allFixturesRoot });
  for (const name of ['nest-no-openapi', 'nest-openapi']) {
    const result = detector.detect({ workspacePath: path.join(allFixturesRoot, name) });
    assert.equal(result.runtimeType, 'BACKEND_API');
    assert.equal(result.framework, 'NESTJS');
    assert.equal(result.startScript, 'start:dev');
    assert.deepEqual(result.command, { executable: 'npm', args: ['run', 'start:dev'], source: 'detected' });
    assert.deepEqual(result.detectionSignals, ['coreDependency', 'cliConfig', 'startScript']);
  }
});

test('NestJS start script 우선순위는 start:dev, start, start:debug 순이다', () => {
  const fixture = makeProject({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '11.2.3' }, scripts: { 'start:debug': 'nest start --debug', start: 'node dist/main.js', 'start:dev': 'nest start --watch' } }),
    'package-lock.json': '{}',
    'nest-cli.json': '{}'
  });
  try {
    const result = new PreviewRuntimeDetector({ developmentRoot: fixture.root }).detect({ workspacePath: fixture.project });
    assert.equal(result.startScript, 'start:dev');
    assert.deepEqual(result.command.args, ['run', 'start:dev']);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('NestJS 단일 신호와 복수 framework 신호는 임의 실행하지 않는다', () => {
  const weak = makeProject({ 'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '11.2.3' }, scripts: { dev: 'node server.js' } }), 'package-lock.json': '{}' });
  const mixed = makeProject({
    'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '11.2.3', vite: '7.0.0' }, scripts: { 'start:dev': 'nest start --watch', dev: 'vite' } }),
    'package-lock.json': '{}',
    'nest-cli.json': '{}'
  });
  try {
    assert.throws(() => new PreviewRuntimeDetector({ developmentRoot: weak.root }).detect({ workspacePath: weak.project }), expectCode('AMBIGUOUS_FRAMEWORK'));
    assert.throws(() => new PreviewRuntimeDetector({ developmentRoot: mixed.root }).detect({ workspacePath: mixed.project }), expectCode('AMBIGUOUS_FRAMEWORK'));
  } finally {
    fs.rmSync(weak.root, { recursive: true, force: true });
    fs.rmSync(mixed.root, { recursive: true, force: true });
  }
});

test('monorepo의 상위 lockfile과 선택된 app 실행 경로를 분리한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hub-monorepo-'));
  const project = path.join(root, 'apps', 'api');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(project, 'nest-cli.json'), '{}');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '11.2.3' }, scripts: { 'start:dev': 'nest start --watch' } }));
  try {
    const result = new PreviewRuntimeDetector({ developmentRoot: root }).detect({ workspacePath: project });
    assert.equal(result.installPath, root);
    assert.equal(result.workingDirectory, path.join('apps', 'api'));
    assert.equal(result.projectPath, project);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    assert.throws(() => new PreviewRuntimeDetector({ developmentRoot: noScript.root }).detect({ workspacePath: noScript.project }), expectCode('START_SCRIPT_NOT_FOUND'));
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

test('Prisma 의존성 또는 schema 파일이 있으면 hasPrisma를 감지한다', () => {
  const withDep = makeProject({
    'package.json': JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0', next: '15.0.0' }, scripts: { dev: 'next dev' } }),
    'package-lock.json': '{}'
  });
  const withSchema = makeProject({
    'package.json': JSON.stringify({ dependencies: { next: '15.0.0' }, scripts: { dev: 'next dev' } }),
    'package-lock.json': '{}'
  });
  fs.mkdirSync(path.join(withSchema.project, 'prisma'));
  fs.writeFileSync(path.join(withSchema.project, 'prisma', 'schema.prisma'), 'datasource db { provider = "mysql" }');

  const withoutPrisma = makeProject({
    'package.json': JSON.stringify({ dependencies: { next: '15.0.0' }, scripts: { dev: 'next dev' } }),
    'package-lock.json': '{}'
  });

  try {
    assert.equal(new PreviewRuntimeDetector({ developmentRoot: withDep.root }).detect({ workspacePath: withDep.project }).hasPrisma, true);
    assert.equal(new PreviewRuntimeDetector({ developmentRoot: withSchema.root }).detect({ workspacePath: withSchema.project }).hasPrisma, true);
    assert.equal(new PreviewRuntimeDetector({ developmentRoot: withoutPrisma.root }).detect({ workspacePath: withoutPrisma.project }).hasPrisma, false);
  } finally {
    fs.rmSync(withDep.root, { recursive: true, force: true });
    fs.rmSync(withSchema.root, { recursive: true, force: true });
    fs.rmSync(withoutPrisma.root, { recursive: true, force: true });
  }
});

