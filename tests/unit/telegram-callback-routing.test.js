import assert from 'node:assert/strict';
import test from 'node:test';
import { isSessionsCallbackData } from '../../src/telegram/callback-routing.js';

test('session callbacks are routed to the sessions handler', () => {
  assert.equal(isSessionsCallbackData('session_page:ARCHIVED:0'), true);
  assert.equal(isSessionsCallbackData('session_info:abc:ARCHIVED:0'), true);
});

test('native session callbacks are routed to the sessions handler', () => {
  assert.equal(isSessionsCallbackData('native_page:1'), true);
  assert.equal(isSessionsCallbackData('native_map:logical-id:0'), true);
  assert.equal(isSessionsCallbackData('native_pick:codex:thread-id'), true);
});

test('unrelated callbacks are not claimed by the sessions handler', () => {
  assert.equal(isSessionsCallbackData('model_provider:codex'), false);
  assert.equal(isSessionsCallbackData('preview_stop:abc'), false);
  assert.equal(isSessionsCallbackData(''), false);
});
