import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const fixturesRoot = path.resolve('tests/fixtures');
const fixtureNames = ['nest-no-openapi', 'nest-openapi'];
const requiredRoutes = [
  "@Get('health')",
  "@Get('items')",
  "@Post('items')",
  "@Patch('items/:id')",
  "@Delete('items/:id')",
  "@Post('upload')",
  "@Sse('events')"
];

function loadFixture(name) {
  const directory = path.join(fixturesRoot, name);
  return {
    directory,
    packageJson: JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')),
    packageLock: JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8')),
    controller: fs.readFileSync(path.join(directory, 'src/app.controller.ts'), 'utf8'),
    main: fs.readFileSync(path.join(directory, 'src/main.ts'), 'utf8')
  };
}

test('NestJS fixture는 버전, lockfile, 실행 계약을 고정한다', () => {
  for (const name of fixtureNames) {
    const fixture = loadFixture(name);
    const packageJson = fixture.packageJson;
    const lockedRoot = fixture.packageLock.packages[''];

    assert.equal(packageJson.packageManager, 'npm@10.8.2');
    assert.deepEqual(packageJson.engines, { node: '20.20.2', npm: '10.8.2' });
    assert.equal(packageJson.dependencies['@nestjs/core'], '11.2.3');
    assert.equal(packageJson.scripts['start:dev'], 'nest start --watch');
    assert.ok(packageJson.scripts.test.includes('node --test'));
    assert.equal(fixture.packageLock.lockfileVersion, 3);
    assert.deepEqual(lockedRoot.dependencies, packageJson.dependencies);
    assert.deepEqual(lockedRoot.devDependencies, packageJson.devDependencies);
    assert.match(fixture.main, /app\.listen\(port, '0\.0\.0\.0'\)/);
    for (const route of requiredRoutes) assert.ok(fixture.controller.includes(route), `${name}: ${route}`);
  }
});

test('Swagger 미설치와 설치 fixture가 dependency 및 bootstrap 단계에서 분리된다', () => {
  const withoutOpenApi = loadFixture('nest-no-openapi');
  const withOpenApi = loadFixture('nest-openapi');

  assert.equal(withoutOpenApi.packageJson.dependencies['@nestjs/swagger'], undefined);
  assert.doesNotMatch(withoutOpenApi.main, /SwaggerModule|docs-json/);

  assert.equal(withOpenApi.packageJson.dependencies['@nestjs/swagger'], '11.4.7');
  assert.equal(withOpenApi.packageJson.dependencies.mysql2, undefined);
  assert.match(withOpenApi.main, /SwaggerModule\.setup\('docs'/);
  assert.match(withOpenApi.main, /jsonDocumentUrl: 'docs-json'/);
  const itemsService = fs.readFileSync(path.join(withOpenApi.directory, 'src/items.service.ts'), 'utf8');
  assert.doesNotMatch(itemsService, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(itemsService, /phase17_preview_items/);
});
