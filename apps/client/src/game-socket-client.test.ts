import assert from 'node:assert/strict';
import test from 'node:test';

import { getReconnectDelayMs } from './reconnect-policy.js';

test('getReconnectDelayMs returns configured backoff sequence', () => {
  assert.equal(getReconnectDelayMs(1), 1_000);
  assert.equal(getReconnectDelayMs(2), 2_000);
  assert.equal(getReconnectDelayMs(3), 5_000);
});

test('getReconnectDelayMs caps delay for attempts outside sequence', () => {
  assert.equal(getReconnectDelayMs(0), 1_000);
  assert.equal(getReconnectDelayMs(4), 10_000);
  assert.equal(getReconnectDelayMs(10), 10_000);
});
