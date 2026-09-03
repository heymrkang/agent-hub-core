import test from 'node:test';
import assert from 'node:assert/strict';
import { AntigravityAdapter } from '../../src/providers/antigravity/antigravity-adapter.js';

test('AntigravityAdapter는 executionProfiles 지원 상태를 SUPPORTED로 보고한다', () => {
  const adapter = new AntigravityAdapter();
  const caps = adapter.getCapabilities();
  assert.equal(caps.executionProfiles, 'SUPPORTED');
});

test('AntigravityAdapter buildArgs는 각 프로필별 가드레일을 올바르게 주입한다', () => {
  const adapter = new AntigravityAdapter();

  const workspaceArgs = adapter.buildArgs({ prompt: '작업 요청', profile: 'WORKSPACE' });
  assert.equal(workspaceArgs.includes('--dangerously-skip-permissions'), true);
  assert.match(workspaceArgs[1], /\[Execution Profile: WORKSPACE\]/);
  assert.match(workspaceArgs[1], /Git 작업\(status, diff, commit, push, branch 등\)은 허용/);
  assert.match(workspaceArgs[1], /외부 파일\(예: \/data, 시스템 파일 등\) 변경과 SSH, Docker 등 인프라 조작은 금지/);

  const readOnlyArgs = adapter.buildArgs({ prompt: '읽기 요청', profile: 'READ_ONLY' });
  assert.equal(readOnlyArgs.includes('--dangerously-skip-permissions'), false);
  assert.match(readOnlyArgs[1], /\[Execution Profile: READ_ONLY\]/);
  assert.match(readOnlyArgs[1], /Git 변경은 차단/);

  const fullAccessArgs = adapter.buildArgs({ prompt: '인프라 요청', profile: 'FULL_ACCESS' });
  assert.equal(fullAccessArgs.includes('--dangerously-skip-permissions'), true);
  assert.match(fullAccessArgs[1], /\[Execution Profile: FULL_ACCESS\]/);
  assert.match(fullAccessArgs[1], /SSH, Docker 등 인프라 도구 사용 및 시스템 전역 작업이 허용/);
});

test('Antigravity restricted sandbox는 workspace 바깥의 cwd를 거부한다', async () => {
  const adapter = new AntigravityAdapter();
  adapter.restrictedRuntime = {
    image: 'test-image',
    workspaceSource: '/host/dev',
    geminiHomeSource: '/host/gemini',
    uploadsSource: null
  };

  await assert.rejects(
    () => adapter.executeRestrictedPrompt({
      prompt: '테스트',
      profile: 'WORKSPACE',
      cwd: '/etc'
    }),
    /WORKSPACE Profile은 .* 밖의 cwd에서 실행할 수 없습니다/
  );
});

test('Antigravity getRestrictedRuntime은 HOSTNAME이 없으면 에러를 던진다', async () => {
  const adapter = new AntigravityAdapter();
  const origHostname = process.env.HOSTNAME;
  try {
    delete process.env.HOSTNAME;
    await assert.rejects(
      () => adapter.getRestrictedRuntime(),
      /Restricted Antigravity 실행을 위한 현재 컨테이너 ID\(HOSTNAME\)를 확인할 수 없습니다/
    );
  } finally {
    if (origHostname) process.env.HOSTNAME = origHostname;
  }
});
