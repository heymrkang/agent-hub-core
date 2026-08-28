import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedUser } from '../../src/telegram/auth.js';

function withTelegramEnv(values, fn) {
  const before = {
    TELEGRAM_ADMIN_USER_ID: process.env.TELEGRAM_ADMIN_USER_ID,
    TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS
  };
  try {
    delete process.env.TELEGRAM_ADMIN_USER_ID;
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    Object.assign(process.env, values);
    return fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Telegram auth fails closed when no allowed user is configured', () => {
  withTelegramEnv({}, () => assert.equal(isAuthorizedUser({ id: 123 }), false));
});

test('Telegram auth allows configured admin and rejects another user', () => {
  withTelegramEnv({ TELEGRAM_ADMIN_USER_ID: '123' }, () => {
    assert.equal(isAuthorizedUser({ id: 123 }), true);
    assert.equal(isAuthorizedUser({ id: 456 }), false);
  });
});

test('Telegram auth supports comma-separated legacy allow list', () => {
  withTelegramEnv({ TELEGRAM_ALLOWED_USER_IDS: '123, 456' }, () => {
    assert.equal(isAuthorizedUser({ id: 456 }), true);
    assert.equal(isAuthorizedUser({ id: 789 }), false);
  });
});

test('Telegram auth rejects missing sender data', () => {
  assert.equal(isAuthorizedUser(null), false);
  assert.equal(isAuthorizedUser({}), false);
});
