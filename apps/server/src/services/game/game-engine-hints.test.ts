import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RoundPhase } from '@skribbl/shared';

import { getRoomState } from '../../repositories/room-repository.js';
import { GameEngine } from './game-engine.js';
import {
  baseState,
  createInMemoryRedis,
  flushAsync,
  makeFakeTimers,
  makeRoomEmitter,
  makeSocket,
} from './game-engine.test-utils.js';

describe('GameEngine hints', () => {
  it('при hintsCount=0 таймеры подсказок не планируются и hint_update не эмитится', async () => {
    const state = baseState({ totalMiniRounds: 1, miniRoundNumber: 0 });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    timers.tick();
    await flushAsync();
    timers.tick();
    await flushAsync();

    const hintEvents = roomEvents.filter((e) => e.event === 'hint_update');
    assert.equal(hintEvents.length, 0);
  });

  it('подсказка выдаётся по таймеру, маска обновляется и hint_update эмитится', async () => {
    const state = baseState({
      totalMiniRounds: 1,
      miniRoundNumber: 0,
      hintsTotal: 1,
      settings: {
        maxPlayers: 8,
        roundTimeSec: 60,
        roundsCount: 1,
        wordChoicesCount: 3,
        hintsCount: 1,
        language: 'ru',
        wordDifficulty: 'medium',
        useCustomWordsOnly: false,
      },
    });
    const { redis, storage } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    timers.tick();
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    assert.equal(afterStart.roundPhase, RoundPhase.Drawing);

    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterStart, word: 'кот', wordMask: '_ _ _', wordLength: 3 }),
    );

    timers.tickFirst();
    await flushAsync();

    const afterHint = await getRoomState(redis, state.roomId);
    assert.ok(afterHint);
    assert.equal(afterHint.hintsUsed, 1);

    const maskChars = afterHint.wordMask.split(' ');
    const revealedCount = maskChars.filter((c) => c !== '_').length;
    assert.equal(revealedCount, 1);
    const wordChars = Array.from('кот');
    for (let i = 0; i < maskChars.length; i += 1) {
      if (maskChars[i] !== '_') {
        assert.equal(maskChars[i], wordChars[i]);
      }
    }

    const hintEvents = roomEvents.filter((e) => e.event === 'hint_update');
    assert.equal(hintEvents.length, 1);
  });

  it('две подсказки выдаются по таймерам на 33% и 66% — маска обновляется дважды', async () => {
    const state = baseState({
      totalMiniRounds: 1,
      miniRoundNumber: 0,
      hintsTotal: 2,
      settings: {
        maxPlayers: 8,
        roundTimeSec: 60,
        roundsCount: 1,
        wordChoicesCount: 3,
        hintsCount: 2,
        language: 'ru',
        wordDifficulty: 'medium',
        useCustomWordsOnly: false,
      },
    });
    const { redis, storage } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    timers.tick();
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterStart, word: 'река', wordMask: '_ _ _ _', wordLength: 4 }),
    );

    timers.tickFirst();
    await flushAsync();

    const afterHint1 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint1);
    assert.equal(afterHint1.hintsUsed, 1);
    const revealed1 = afterHint1.wordMask.split(' ').filter((c) => c !== '_').length;
    assert.equal(revealed1, 1);

    timers.tickFirst();
    await flushAsync();

    const afterHint2 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint2);
    assert.equal(afterHint2.hintsUsed, 2);
    const revealed2 = afterHint2.wordMask.split(' ').filter((c) => c !== '_').length;
    assert.equal(revealed2, 2);

    const hintEvents = roomEvents.filter((e) => e.event === 'hint_update');
    assert.equal(hintEvents.length, 2);
  });

  it('подсказка не раскрывает последний нераскрытый символ', async () => {
    const state = baseState({
      totalMiniRounds: 1,
      miniRoundNumber: 0,
      hintsTotal: 1,
      settings: {
        maxPlayers: 8,
        roundTimeSec: 60,
        roundsCount: 1,
        wordChoicesCount: 3,
        hintsCount: 1,
        language: 'ru',
        wordDifficulty: 'medium',
        useCustomWordsOnly: false,
      },
    });
    const { redis, storage } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    timers.tick();
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({
        ...afterStart,
        word: 'лес',
        wordMask: 'л е _',
        wordLength: 3,
        hintsUsed: 2,
      }),
    );

    timers.tickFirst();
    await flushAsync();

    const afterHint = await getRoomState(redis, state.roomId);
    assert.ok(afterHint);
    assert.equal(afterHint.wordMask, 'л е _');
    assert.equal(afterHint.hintsUsed, 2);

    const hintEvents = roomEvents.filter((e) => e.event === 'hint_update');
    assert.equal(hintEvents.length, 0);
  });

  it('оставшиеся подсказки не выдаются после завершения drawing', async () => {
    const state = baseState({
      totalMiniRounds: 1,
      miniRoundNumber: 0,
      hintsTotal: 2,
      settings: {
        maxPlayers: 8,
        roundTimeSec: 60,
        roundsCount: 1,
        wordChoicesCount: 3,
        hintsCount: 2,
        language: 'ru',
        wordDifficulty: 'medium',
        useCustomWordsOnly: false,
      },
    });
    const { redis, storage } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    timers.tick();
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterStart, word: 'море', wordMask: '_ _ _ _', wordLength: 4 }),
    );

    timers.tickFirst();
    await flushAsync();

    const afterHint1 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint1);
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterHint1, roundPhase: RoundPhase.RoundEnd }),
    );

    timers.tickFirst();
    await flushAsync();

    const afterHint2 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint2);
    assert.equal(afterHint2.hintsUsed, 1);
    assert.equal(afterHint2.wordMask.split(' ').filter((c) => c !== '_').length, 1);

    const hintEvents = roomEvents.filter((e) => e.event === 'hint_update');
    assert.equal(hintEvents.length, 1);
  });
});
