import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  getCurrentCommit,
  checkAndNotifyStartup
} from '../../src/deploy/startup-notifier.js';

test('getCurrentCommit returns a commit string', () => {
  const commit = getCurrentCommit();
  assert.ok(typeof commit === 'string');
  assert.ok(commit.length > 0);
});

test('checkAndNotifyStartup handles first run, unchanged reboot, and new deployment', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-notify-test-'));

  const sentMessages = [];
  const mockBot = {
    async sendMessage(chatId, text, options) {
      sentMessages.push({ chatId, text, options });
      return { message_id: sentMessages.length };
    }
  };

  const ownerId = '12345678';

  // 1. 최초 기동 (First Run)
  const firstRes = await checkAndNotifyStartup({
    bot: mockBot,
    ownerId,
    dataDir: tempDir
  });

  assert.equal(firstRes.notified, true);
  assert.equal(firstRes.isNewDeployment, false);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /정상 기동 완료/);

  // 상태 파일 생성 확인
  const stateFile = path.join(tempDir, 'system', 'startup_state.json');
  assert.ok(fs.existsSync(stateFile));
  const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  assert.equal(savedState.commit, firstRes.currentCommit);

  // 2. 커밋 변경 없는 단순 재부팅 (Unchanged Reboot) -> 알림 스킵
  const secondRes = await checkAndNotifyStartup({
    bot: mockBot,
    ownerId,
    dataDir: tempDir
  });

  assert.equal(secondRes.notified, false);
  assert.equal(sentMessages.length, 1); // 추가 전송 없음

  // 3. 새 커밋 배포 감지 (New Deployment)
  // 이전 커밋을 fake로 조작
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ commit: 'old1234', startedAt: new Date().toISOString() })
  );

  const thirdRes = await checkAndNotifyStartup({
    bot: mockBot,
    ownerId,
    dataDir: tempDir
  });

  assert.equal(thirdRes.notified, true);
  assert.equal(thirdRes.isNewDeployment, true);
  assert.equal(thirdRes.lastCommit, 'old1234');
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1].text, /배포 및 정상 기동 완료/);
  assert.match(sentMessages[1].text, /old1234/);
});
