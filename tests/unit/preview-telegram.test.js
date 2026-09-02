import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPreviewEndpointUrl,
  formatDetectedRuntime,
  handlePreviewCallback,
  parsePreviewStartArgs
} from '../../src/telegram/commands/preview.js';

function callbackQuery(data = 'preview_detail:preview-1') {
  return {
    id: 'callback-1', data, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 9 }
  };
}

async function renderPreview(preview) {
  let rendered;
  const bot = {
    answerCallbackQuery: async () => {},
    editMessageText: async (text, options) => { rendered = { text, options }; }
  };
  const registry = { requireOwned: () => preview, require: () => preview };
  await handlePreviewCallback(bot, callbackQuery(), { registry, manager: {} });
  return rendered;
}

test('Preview start 인자에서 레포명과 수동 port를 파싱한다', () => {
  assert.deepEqual(parsePreviewStartArgs('my-app --port 4173'), {
    repositoryName: 'my-app',
    manualPort: 4173
  });
  assert.deepEqual(parsePreviewStartArgs('app.repo'), {
    repositoryName: 'app.repo',
    manualPort: null
  });
});

test('Preview start는 경로 입력과 잘못된 port를 거부한다', () => {
  assert.throws(() => parsePreviewStartArgs('/home/dev/workspace/app'), /레포명/);
  assert.throws(() => parsePreviewStartArgs('workspace/app'), /레포명/);
  assert.throws(() => parsePreviewStartArgs('repo-name --port 70000'), /1~65535/);
  assert.throws(() => parsePreviewStartArgs(''), /사용법/);
});

test('시작 전 감지 runtime과 argv command를 표시한다', () => {
  const text = formatDetectedRuntime({
    runtimeType: 'BACKEND_API',
    framework: 'NESTJS',
    command: { executable: 'npm', args: ['run', 'start:dev'] }
  });
  assert.match(text, /BACKEND\\_API \/ NESTJS/);
  assert.match(text, /npm run start:dev/);
});

test('Access 미검증 BACKEND_API 상세 화면은 외부 URL과 열기 버튼을 숨긴다', async () => {
  const preview = {
    id: 'preview-1', project_name: 'api', runtime_type: 'BACKEND_API', access_verified: false,
    framework: 'NESTJS', status: 'RUNNING', public_url: 'https://preview-api.12190529.xyz', port: 3000,
    openapi_ui_path: '/docs', openapi_json_path: '/docs-json', health_path: '/health', started_at: null
  };
  const rendered = await renderPreview(preview);
  assert.match(rendered.text, /Cloudflare Access 미검증/);
  assert.doesNotMatch(rendered.text, /https:\/\/preview-api/);
  assert.match(rendered.text, /OpenAPI: UI `\/docs` · JSON `\/docs-json`/);
  assert.equal(rendered.options.reply_markup.inline_keyboard.flat().some(({ url }) => Boolean(url)), false);
});

test('Access 검증된 BACKEND_API 상세 화면은 API 상태와 endpoint action을 표시한다', async () => {
  const preview = {
    id: 'preview-1', project_name: 'items-api', runtime_type: 'BACKEND_API', access_verified: true,
    framework: 'NESTJS', status: 'RUNNING', public_url: 'https://preview-items.12190529.xyz', port: 3000,
    openapi_ui_path: '/docs', openapi_json_path: '/docs-json', health_path: '/health', started_at: null
  };
  const rendered = await renderPreview(preview);
  assert.match(rendered.text, /API Preview · items-api/);
  assert.match(rendered.text, /Runtime: `NestJS \/ Port 3000`/);
  assert.match(rendered.text, /데이터 대상: `dev 전용`/);
  assert.match(rendered.text, /개발 데이터를 실제 변경/);
  const buttons = rendered.options.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.filter(({ url }) => url).map(({ text, url }) => [text, url]), [
    ['🌐 API 열기', 'https://preview-items.12190529.xyz'],
    ['📚 API 문서', 'https://preview-items.12190529.xyz/docs'],
    ['🧾 OpenAPI JSON', 'https://preview-items.12190529.xyz/docs-json'],
    ['🩺 Health 확인', 'https://preview-items.12190529.xyz/health']
  ]);
  assert.equal(buttons.some(({ callback_data }) => callback_data === 'preview_logs:preview-1'), true);
  assert.equal(buttons.some(({ callback_data }) => callback_data === 'preview_restart:preview-1'), true);
  assert.equal(buttons.some(({ callback_data }) => callback_data === 'preview_stop:preview-1'), true);
});

test('OpenAPI 미탐지 BACKEND_API는 RUNNING과 health action을 유지한다', async () => {
  const preview = {
    id: 'preview-1', project_name: 'plain-api', runtime_type: 'BACKEND_API', access_verified: true,
    framework: 'NESTJS', status: 'RUNNING', public_url: 'https://preview-plain.12190529.xyz', port: 3000,
    openapi_ui_path: null, openapi_json_path: null, health_path: '/health', started_at: null
  };
  const rendered = await renderPreview(preview);
  assert.match(rendered.text, /상태: `RUNNING`/);
  assert.match(rendered.text, /OpenAPI: `미탐지`/);
  const buttons = rendered.options.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.some(({ text }) => text === '📚 API 문서' || text === '🧾 OpenAPI JSON'), false);
  assert.equal(buttons.some(({ url }) => url === 'https://preview-plain.12190529.xyz/health'), true);
});

test('Preview endpoint URL은 HTTPS origin과 절대 path만 허용한다', () => {
  assert.equal(buildPreviewEndpointUrl({ public_url: 'https://preview.example.com' }, '/docs'), 'https://preview.example.com/docs');
  assert.equal(buildPreviewEndpointUrl({ public_url: 'http://preview.example.com' }, '/docs'), null);
  assert.equal(buildPreviewEndpointUrl({ public_url: 'https://preview.example.com' }, 'docs'), null);
  assert.equal(buildPreviewEndpointUrl({ public_url: 'https://preview.example.com' }, '//evil.example/docs'), null);
  assert.equal(buildPreviewEndpointUrl({ public_url: 'https://preview.example.com' }, '/\\evil.example/docs'), null);
  assert.equal(buildPreviewEndpointUrl({ public_url: 'not-a-url' }, '/docs'), null);
});
