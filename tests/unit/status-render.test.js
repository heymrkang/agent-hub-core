import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatus } from '../../src/telegram/commands/status.js';

test('status UI는 섹션과 provider/model quota 계층을 줄바꿈으로 구분한다', () => {
  const text = renderStatus({
    snapshot: {
      state: 'HEALTHY',
      checkedAt: '2026-09-01T08:06:15.007Z',
      checks: [
        { state: 'HEALTHY', name: 'Database', detail: 'SQLite quick_check OK' },
        { state: 'HEALTHY', name: 'Provider:codex', detail: 'CLI OK / AUTH PRESENT' }
      ]
    },
    quotas: [
      { provider: 'codex', status: 'AVAILABLE', fetchedAt: '2026-09-01T08:06:15.072Z', windows: [
        { label: '5시간 한도', remainingPercent: 31 },
        { label: '주간 한도', remainingPercent: 78 }
      ] },
      { provider: 'antigravity', status: 'AVAILABLE', fetchedAt: '2026-09-01T08:06:20.609Z', windows: [
        { group: 'Gemini Models', label: '주간 한도', remainingPercent: 90 },
        { group: 'Gemini Models', label: '5시간 한도', remainingPercent: 96 },
        { group: 'Claude and GPT models', label: '주간 한도', remainingPercent: 100 }
      ] }
    ],
    session: { title: 'Phase 15 Up', active_provider: 'codex', active_model: 'gpt-5.6-sol', reasoning_effort: 'medium', execution_profile: 'FULL_ACCESS' },
    activeJob: null,
    recentFailure: { error_category: 'TIMEOUT', created_at: '2026-09-01 07:31:17', error_message: 'Antigravity 실행 타임아웃' },
    version: '0.1.0',
    schema: 13,
    stealth: true
  });

  for (const section of ['SUMMARY', 'HEALTH CHECK', 'ACTIVE SESSION', 'PROVIDER QUOTA', 'RECENT FAILURE', 'CHECKED']) {
    assert.match(text, new RegExp(`\\[${section}\\]`));
  }
  assert.match(text, /\[OK\] \*\*Database\*\*\nSQLite quick\\_check OK\n\n/);
  assert.match(text, /◆ \*CODEX\* · `AVAILABLE`\n\*\*5시간 한도\*\* 31% 남음\n\*\*주간 한도\*\* 78% 남음/);
  assert.match(text, /◆ \*ANTIGRAVITY\* · `AVAILABLE`\n\n◇ \*Gemini Models\*/);
  assert.match(text, /◇ \*Claude and GPT models\*/);
  assert.doesNotMatch(text, /Gemini Models 주간 한도.*·/);
  assert.doesNotMatch(text, /2026-09-01T08:06:20\.609Z/);
});
