import assert from 'node:assert/strict';
import test from 'node:test';

import { getEventCategory, SocketRateLimiter, TokenBucket } from './rate-limiter.js';

test('TokenBucket: allows up to capacity events immediately', () => {
  const bucket = new TokenBucket(10);

  for (let i = 0; i < 10; i++) {
    assert.equal(bucket.consume(), true, `token ${i} should be available`);
  }

  assert.equal(bucket.consume(), false, 'should be blocked after capacity is exhausted');
});

test('TokenBucket: blocks when empty', () => {
  const bucket = new TokenBucket(5);

  for (let i = 0; i < 5; i++) bucket.consume();

  assert.equal(bucket.consume(), false);
});

test('TokenBucket: refills tokens over time', () => {
  let now = 0;
  const bucket = new TokenBucket(10, 10, () => now);

  for (let i = 0; i < 10; i++) bucket.consume();
  assert.equal(bucket.consume(), false, 'empty before refill');

  now += 1000;
  assert.equal(bucket.consume(), true, 'one token available after 1s');

  for (let i = 0; i < 9; i++) bucket.consume();
  assert.equal(bucket.consume(), false, 'exhausted again after consuming all refilled tokens');
});

test('TokenBucket: partial refill allows partial consumption', () => {
  let now = 0;
  const bucket = new TokenBucket(10, 10, () => now);

  for (let i = 0; i < 10; i++) bucket.consume();
  assert.equal(bucket.consume(), false);

  now += 300;
  let consumed = 0;
  for (let i = 0; i < 5; i++) {
    if (bucket.consume()) consumed++;
  }
  assert.equal(consumed, 3, '300ms at 10/s should refill ~3 tokens');
});

test('getEventCategory: maps draw and guess correctly', () => {
  assert.equal(getEventCategory('draw'), 'draw');
  assert.equal(getEventCategory('guess'), 'guess');
});

test('getEventCategory: maps unknown events to other', () => {
  assert.equal(getEventCategory('create_room'), 'other');
  assert.equal(getEventCategory('join_room'), 'other');
  assert.equal(getEventCategory('start_game'), 'other');
  assert.equal(getEventCategory('choose_word'), 'other');
});

test('SocketRateLimiter: enforces draw limit at 60/s', () => {
  const limiter = new SocketRateLimiter();
  let allowed = 0;

  for (let i = 0; i < 70; i++) {
    if (limiter.consume('draw')) allowed++;
  }

  assert.equal(allowed, 60, 'draw should allow exactly 60 per second');
});

test('SocketRateLimiter: enforces guess limit at 5/s', () => {
  const limiter = new SocketRateLimiter();
  let allowed = 0;

  for (let i = 0; i < 10; i++) {
    if (limiter.consume('guess')) allowed++;
  }

  assert.equal(allowed, 5, 'guess should allow exactly 5 per second');
});

test('SocketRateLimiter: enforces other limit at 10/s', () => {
  const limiter = new SocketRateLimiter();
  let allowed = 0;

  for (let i = 0; i < 20; i++) {
    if (limiter.consume('start_game')) allowed++;
  }

  assert.equal(allowed, 10, 'other events should allow exactly 10 per second');
});

test('SocketRateLimiter: tracks categories independently', () => {
  const limiter = new SocketRateLimiter();

  for (let i = 0; i < 5; i++) limiter.consume('guess');
  assert.equal(limiter.consume('guess'), false, 'guess should be exhausted');
  assert.equal(limiter.consume('draw'), true, 'draw bucket should be unaffected');
  assert.equal(limiter.consume('start_game'), true, 'other bucket should be unaffected');
});

test('SocketRateLimiter: refills across all categories over time', () => {
  let now = 0;
  const limiter = new SocketRateLimiter(() => now);

  for (let i = 0; i < 60; i++) limiter.consume('draw');
  for (let i = 0; i < 5; i++) limiter.consume('guess');
  for (let i = 0; i < 10; i++) limiter.consume('start_game');

  assert.equal(limiter.consume('draw'), false);
  assert.equal(limiter.consume('guess'), false);
  assert.equal(limiter.consume('start_game'), false);

  now += 1000;

  assert.equal(limiter.consume('draw'), true, 'draw should refill after 1s');
  assert.equal(limiter.consume('guess'), true, 'guess should refill after 1s');
  assert.equal(limiter.consume('start_game'), true, 'other should refill after 1s');
});
