import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getReconnectDelayMs } from './reconnect-policy.js';

describe('getReconnectDelayMs', () => {
  it('возвращает настроенную последовательность backoff', () => {
    assert.equal(getReconnectDelayMs(1), 1_000);
    assert.equal(getReconnectDelayMs(2), 2_000);
    assert.equal(getReconnectDelayMs(3), 5_000);
  });

  it('ограничивает задержку для попыток вне последовательности', () => {
    assert.equal(getReconnectDelayMs(0), 1_000);
    assert.equal(getReconnectDelayMs(4), 10_000);
    assert.equal(getReconnectDelayMs(10), 10_000);
  });
});
