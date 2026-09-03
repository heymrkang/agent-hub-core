import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  parseCoolifyPayload,
  formatDeployNotification,
  createCoolifyWebhookHandler
} from '../../src/webhooks/coolify-webhook.js';

test('parseCoolifyPayload extracts deployment details correctly', () => {
  // 1. 성공 페이로드
  const successPayload = {
    status: 'success',
    application_name: 'heymrkang-blog',
    commit: '9cb9de2a8f1234567890',
    commit_message: 'fix: update layout',
    duration: '1m 24s'
  };
  const parsedSuccess = parseCoolifyPayload(successPayload);
  assert.equal(parsedSuccess.isSuccess, true);
  assert.equal(parsedSuccess.isFailure, false);
  assert.equal(parsedSuccess.appName, 'heymrkang-blog');
  assert.equal(parsedSuccess.commit, '9cb9de2');
  assert.equal(parsedSuccess.duration, '1m 24s');

  // 2. 실패 페이로드
  const failPayload = {
    event: 'deployment-failed',
    name: 'backend-api',
    commit_hash: '1234567890abcdef',
    error: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nBuild failed with exit code 1'
  };
  const parsedFail = parseCoolifyPayload(failPayload);
  assert.equal(parsedFail.isSuccess, false);
  assert.equal(parsedFail.isFailure, true);
  assert.equal(parsedFail.appName, 'backend-api');
  assert.equal(parsedFail.commit, '1234567');
  assert.match(parsedFail.error, /Build failed with exit code 1/);
  // 최대 5줄만 남기는지 확인
  assert.equal(parsedFail.error.split('\n').length, 5);
});

test('formatDeployNotification renders markdown correctly', () => {
  const successText = formatDeployNotification({
    isSuccess: true,
    isFailure: false,
    appName: 'blog',
    commit: 'abcdef1',
    message: 'test commit',
    duration: '45s',
    error: ''
  });
  assert.match(successText, /Coolify 배포 성공/);
  assert.match(successText, /blog/);
  assert.match(successText, /abcdef1/);
  assert.match(successText, /45s/);

  const failText = formatDeployNotification({
    isSuccess: false,
    isFailure: true,
    appName: 'api',
    commit: '1234567',
    message: 'broken build',
    duration: '10s',
    error: 'npm ERR! missing dependency'
  });
  assert.match(failText, /Coolify 배포 실패/);
  assert.match(failText, /api/);
  assert.match(failText, /missing dependency/);
});

test('createCoolifyWebhookHandler handles HTTP requests and pushes telegram alert', async (t) => {
  const sentMessages = [];
  const mockBot = {
    async sendMessage(chatId, text, options) {
      sentMessages.push({ chatId, text, options });
      return { message_id: 1 };
    }
  };

  const secretToken = 'super-secret-token-123';
  const handler = createCoolifyWebhookHandler({
    bot: mockBot,
    adminUserId: '999888',
    secretToken
  });

  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  t.after(() => new Promise((resolve) => server.close(resolve)));

  // 1. GET /health -> 200
  const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.equal(healthJson.status, 'healthy');

  // 2. 잘못된 경로 -> 404
  const notFoundRes = await fetch(`http://127.0.0.1:${port}/unknown`);
  assert.equal(notFoundRes.status, 404);

  // 3. 토큰 불일치 -> 401
  const unauthRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/coolify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'success' })
  });
  assert.equal(unauthRes.status, 401);

  // 4. 정상 배포 완료 웹훅 수신 (URL 쿼리 토큰 방식)
  const successPostRes = await fetch(
    `http://127.0.0.1:${port}/api/webhooks/coolify?token=${secretToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'success',
        application_name: 'heymrkang-blog',
        commit: '7289061111',
        commit_message: 'feat: add dark mode',
        duration: '1m 15s'
      })
    }
  );

  assert.equal(successPostRes.status, 200);
  const successJson = await successPostRes.json();
  assert.equal(successJson.ok, true);
  assert.equal(successJson.app, 'heymrkang-blog');
  assert.equal(successJson.status, 'success');

  // 텔레그램 푸시 확인
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, '999888');
  assert.match(sentMessages[0].text, /heymrkang-blog/);
  assert.match(sentMessages[0].text, /배포 성공/);

  // 5. 배포 실패 웹훅 수신 (헤더 토큰 방식)
  const failPostRes = await fetch(`http://127.0.0.1:${port}/api/webhooks/coolify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Coolify-Token': secretToken
    },
    body: JSON.stringify({
      status: 'failed',
      application_name: 'heymrkang-blog',
      commit: '7289061',
      error: 'Error: Cannot find module express'
    })
  });

  assert.equal(failPostRes.status, 200);
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1].text, /배포 실패/);
  assert.match(sentMessages[1].text, /Cannot find module express/);
});
