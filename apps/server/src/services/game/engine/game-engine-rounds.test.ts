import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GamePhase, RoundPhase } from '@skribbl/shared';

import { getRoomState } from '../../../repositories/room-repository.js';
import type { WordService } from '../../word-service/word-service.js';
import { GameEngine } from './game-engine.js';
import {
  baseState,
  createInMemoryRedis,
  flushAsync,
  makeFakeTimers,
  makeNamespace,
  makeRoomEmitter,
  makeSocket,
} from '../testing/game-engine.test-utils.js';

describe('GameEngine rounds', () => {
  it('переводит комнату в word_selection после start_game от owner', async () => {
    const state = baseState();
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket, events: socketEvents } = makeSocket({
      roomId: state.roomId,
      playerId: 'owner-id',
    });

    await engine.handleStartGame(socket, { roomId: state.roomId });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    assert.equal(savedState.phase, GamePhase.InGame);
    assert.equal(savedState.roundPhase, RoundPhase.WordSelection);
    assert.equal(savedState.miniRoundNumber, 1);
    assert.equal(socketEvents.length, 0);
    assert.equal(roomEvents[0]?.event, 'round_start');
  });

  it('отклоняет start_game для не-owner', async () => {
    const state = baseState();
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket, events: socketEvents } = makeSocket({
      roomId: state.roomId,
      playerId: 'p2',
    });

    await engine.handleStartGame(socket, { roomId: state.roomId });

    assert.equal(socketEvents.length, 1);
    const payload = socketEvents[0]?.payload as { ok: false; error: { code: string } };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'forbidden_action');
  });

  it('в фазе word_selection варианты слов получает только ведущий', async () => {
    const state = baseState();
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const { socket: leaderSocket, events: leaderEvents } = makeSocket({
      roomId: state.roomId,
      playerId: 'owner-id',
    });
    const { socket: guesserSocket, events: guesserEvents } = makeSocket({
      roomId: state.roomId,
      playerId: 'p2',
    });
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
      namespace: makeNamespace([leaderSocket, guesserSocket]),
    });

    await engine.handleStartGame(leaderSocket, { roomId: state.roomId });

    assert.equal(roomEvents.length, 0);
    assert.equal(leaderEvents.length, 1);
    assert.equal(guesserEvents.length, 1);
    const leaderPayload = leaderEvents[0]?.payload as { wordOptions: string[] };
    const guesserPayload = guesserEvents[0]?.payload as { wordOptions: string[] };
    assert.equal(leaderEvents[0]?.event, 'round_start');
    assert.equal(guesserEvents[0]?.event, 'round_start');
    assert.equal(leaderPayload.wordOptions.length, 3);
    assert.deepEqual(guesserPayload.wordOptions, []);
  });

  it('выполняет автопереходы по таймерам до game_over', async () => {
    const state = baseState({ totalMiniRounds: 1, miniRoundNumber: 0 });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({
      roomId: state.roomId,
      playerId: 'owner-id',
    });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    timers.tick();
    await flushAsync();

    let updatedState = await getRoomState(redis, state.roomId);
    assert.ok(updatedState);
    assert.equal(updatedState.roundPhase, RoundPhase.Drawing);

    timers.tick();
    await flushAsync();

    updatedState = await getRoomState(redis, state.roomId);
    assert.ok(updatedState);
    assert.equal(updatedState.roundPhase, RoundPhase.RoundEnd);

    timers.tick();
    await flushAsync();

    updatedState = await getRoomState(redis, state.roomId);
    assert.ok(updatedState);
    assert.equal(updatedState.phase, GamePhase.GameOver);

    const eventNames = roomEvents.map((entry) => entry.event);
    assert.ok(eventNames.includes('round_start'));
    assert.ok(eventNames.includes('round_end'));
    assert.ok(eventNames.includes('game_over'));
  });

  it('wordOptions после start_game содержит количество слов из настроек комнаты', async () => {
    const state = baseState();
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    assert.equal(savedState.wordOptions.length, 3);
    assert.ok(savedState.wordOptions.every((w) => typeof w === 'string' && w.length > 0));
  });

  it('wordOptions после start_game учитывает кастомное wordChoicesCount', async () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        wordChoicesCount: 5,
      },
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    assert.equal(savedState.wordOptions.length, 5);
    assert.ok(savedState.wordOptions.every((w) => typeof w === 'string' && w.length > 0));
  });

  it('wordOptions после start_game запрашиваются только для выбранной сложности', async () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        wordDifficulty: 'hard',
      },
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const calls: Array<{
      count: number;
      difficulty: 'medium' | 'hard';
      excludedWords: string[];
    }> = [];
    const stubWordService = {
      getWordOptions: (
        count: number,
        difficulty: 'medium' | 'hard',
        excludedWords: readonly string[] = [],
      ) => {
        calls.push({ count, difficulty, excludedWords: [...excludedWords] });
        return ['трансформатор', 'метеорология', 'архипелаг'].slice(0, count);
      },
      pickFallbackWord: (_difficulty: 'medium' | 'hard') => 'трансформатор',
      getWordCount: () => 500,
    } as unknown as WordService;
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
      wordService: stubWordService,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    assert.deepEqual(calls, [{ count: 3, difficulty: 'hard', excludedWords: [] }]);
    assert.deepEqual(savedState.wordOptions, ['трансформатор', 'метеорология', 'архипелаг']);
  });

  it('в новом mini-round не предлагает уже выбранные в прошлых раундах слова', async () => {
    const state = baseState({ totalMiniRounds: 2, miniRoundNumber: 0 });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const calls: string[][] = [];

    const stubWordService = {
      getWordOptions: (
        count: number,
        _difficulty: 'medium' | 'hard',
        excludedWords: readonly string[] = [],
      ) => {
        calls.push([...excludedWords]);
        const initialOptions = ['кот', 'лес', 'дом'];
        const nextOptions = ['река', 'море', 'гора'];
        return (excludedWords.includes('кот') ? nextOptions : initialOptions).slice(0, count);
      },
      pickFallbackWord: (_difficulty: 'medium' | 'hard') => 'кот',
      getWordCount: () => 500,
    } as unknown as WordService;

    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
      wordService: stubWordService,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    await engine.handleChooseWord(socket, { roomId: state.roomId, word: 'кот' });

    let drawingState = await getRoomState(redis, state.roomId);
    assert.ok(drawingState);
    assert.deepEqual(drawingState.usedWords, ['кот']);

    timers.tickFirst();
    await flushAsync();
    await flushAsync();
    timers.tickFirst();
    await flushAsync();
    await flushAsync();

    const nextState = await getRoomState(redis, state.roomId);
    assert.ok(nextState);
    assert.equal(nextState.roundPhase, RoundPhase.WordSelection);
    assert.deepEqual(nextState.usedWords, ['кот']);
    assert.deepEqual(nextState.wordOptions, ['река', 'море', 'гора']);
    assert.deepEqual(calls, [[], ['кот']]);
  });

  it('таймаут выбора слова автоматически выбирает слово из wordOptions', async () => {
    const lobbyState = baseState({ totalMiniRounds: 1, miniRoundNumber: 0 });
    const { redis: redis2, storage: storage2 } = createInMemoryRedis(lobbyState);
    const { roomEmitterTarget: emitter2 } = makeRoomEmitter();
    const timers2 = makeFakeTimers();
    const engine2 = new GameEngine(redis2, emitter2, {
      setTimeout: timers2.fakeSetTimeout,
      clearTimeout: timers2.fakeClearTimeout,
    });
    const { socket: socket2 } = makeSocket({ roomId: lobbyState.roomId, playerId: 'owner-id' });

    await engine2.handleStartGame(socket2, { roomId: lobbyState.roomId });

    const stateAfterStart = await getRoomState(redis2, lobbyState.roomId);
    assert.ok(stateAfterStart);
    const knownOptions = ['кот', 'велосипед', 'библиотека'];
    storage2.set(
      `skribbl:room:${lobbyState.roomId}`,
      JSON.stringify({ ...stateAfterStart, wordOptions: knownOptions }),
    );

    timers2.tick();
    await flushAsync();

    const resultState = await getRoomState(redis2, lobbyState.roomId);
    assert.ok(resultState);
    assert.equal(resultState.roundPhase, RoundPhase.Drawing);
    const expectedLengths = knownOptions.map((w) => Array.from(w).length);
    const maskLength = resultState.wordMask.split(' ').filter(Boolean).length;
    assert.equal(maskLength, resultState.wordLength);
    assert.ok(expectedLengths.includes(maskLength));
    assert.ok(resultState.wordMask.split(' ').every((char) => char === '_'));
  });

  it('ведущий меняется после каждого раунда', async () => {
    const state = baseState({ totalMiniRounds: 2, miniRoundNumber: 0 });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    let s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.leaderPlayerId, 'owner-id');
    assert.equal(s.roundPhase, RoundPhase.WordSelection);

    timers.tick();
    await flushAsync();
    s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.roundPhase, RoundPhase.Drawing);
    assert.equal(s.leaderPlayerId, 'owner-id');

    timers.tick();
    await flushAsync();
    s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.roundPhase, RoundPhase.RoundEnd);
    assert.equal(s.leaderPlayerId, 'p2');

    timers.tick();
    await flushAsync();
    s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.roundPhase, RoundPhase.WordSelection);
    assert.equal(s.leaderPlayerId, 'p2');
  });

  it('отклоняет choose_word, если слово не входит в wordOptions', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.WordSelection,
      miniRoundNumber: 1,
      wordOptions: ['apple', 'rocket', 'ocean'],
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket, events: socketEvents } = makeSocket({
      roomId: state.roomId,
      playerId: 'owner-id',
    });

    await engine.handleChooseWord(socket, { roomId: state.roomId, word: 'castle' });

    assert.equal(socketEvents.length, 1);
    const payload = socketEvents[0]?.payload as { ok: false; error: { code: string } };
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'invalid_payload');
  });
});
