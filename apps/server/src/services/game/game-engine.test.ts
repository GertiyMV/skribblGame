import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout } from 'node:timers';

import { GamePhase, RoundPhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { getRoomState, type RoomState } from '../../repositories/room-repository.js';
import type { GameSocket, RoomEmitterTarget, SocketData } from '../../types/socket.js';
import { GameEngine } from './game-engine.js';

const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createInMemoryRedis = (initialState?: RoomState) => {
  const storage = new Map<string, string>();
  if (initialState) {
    storage.set(`skribbl:room:${initialState.roomId}`, JSON.stringify(initialState));
  }

  const redis = {
    get: async (key: string) => storage.get(key) ?? null,
    set: async (key: string, value: string) => {
      storage.set(key, value);
      return 'OK' as const;
    },
  } as unknown as RedisClientType;

  return { redis, storage };
};

const makeRoomEmitter = () => {
  const events: { roomId: string; event: string; payload: unknown }[] = [];
  const roomEmitterTarget = {
    to: (roomId: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ roomId, event, payload });
      },
    }),
  } as unknown as RoomEmitterTarget;

  return { roomEmitterTarget, events };
};

const makeSocket = (data: SocketData) => {
  const events: { event: string; payload: unknown }[] = [];
  const socket = {
    data,
    emit: (event: string, payload: unknown) => {
      events.push({ event, payload });
    },
  } as unknown as GameSocket;

  return { socket, events };
};

const makeFakeTimers = () => {
  const pending = new Map<number, () => void>();
  let nextId = 1;

  const fakeSetTimeout = (fn: () => void, _ms: number): ReturnType<typeof setTimeout> => {
    const id = nextId++;
    pending.set(id, fn);
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  const fakeClearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    pending.delete(handle as unknown as number);
  };

  const tick = (): void => {
    for (const [id, fn] of [...pending]) {
      pending.delete(id);
      fn();
    }
  };

  return { fakeSetTimeout, fakeClearTimeout, tick };
};

const baseState = (overrides: Partial<RoomState> = {}): RoomState => ({
  roomId: 'ROOM01',
  phase: GamePhase.Lobby,
  roundPhase: RoundPhase.RoundEnd,
  miniRoundNumber: 0,
  totalMiniRounds: 1,
  leaderPlayerId: 'owner-id',
  roundEndAt: '2026-04-08T12:00:00.000Z',
  wordOptions: [],
  wordMask: '',
  wordLength: 0,
  hintsUsed: 0,
  hintsTotal: 3,
  players: [
    {
      id: 'owner-id',
      nickname: 'Owner',
      score: 10,
      isOwner: true,
      guessed: false,
      connectionStatus: 'connected',
      role: 'guessing',
    },
    {
      id: 'p2',
      nickname: 'P2',
      score: 3,
      isOwner: false,
      guessed: false,
      connectionStatus: 'connected',
      role: 'guessing',
    },
  ],
  settings: {
    maxPlayers: 8,
    roundTimeSec: 80,
    roundsCount: 1,
    wordChoicesCount: 3,
    hintsCount: 3,
    language: 'ru',
    useCustomWordsOnly: false,
  },
  ...overrides,
});

describe('GameEngine', () => {
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

  it('таймаут выбора слова автоматически выбирает слово из wordOptions', async () => {
    // Полный цикл: start_game -> подмена wordOptions -> timeout word_selection.
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

    // Подменяем wordOptions в redis, чтобы знать точный набор
    const stateAfterStart = await getRoomState(redis2, lobbyState.roomId);
    assert.ok(stateAfterStart);
    const knownOptions = ['кот', 'велосипед', 'библиотека'];
    storage2.set(
      `skribbl:room:${lobbyState.roomId}`,
      JSON.stringify({ ...stateAfterStart, wordOptions: knownOptions }),
    );

    // Тикаем — срабатывает таймер word_selection, слово выбирается автоматически
    timers2.tick();
    await flushAsync();

    const resultState = await getRoomState(redis2, lobbyState.roomId);
    assert.ok(resultState);
    assert.equal(resultState.roundPhase, RoundPhase.Drawing);
    // Длина маски должна соответствовать выбранному слову.
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

    // Старт игры: owner-id — первый ведущий
    await engine.handleStartGame(socket, { roomId: state.roomId });
    let s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.leaderPlayerId, 'owner-id');
    assert.equal(s.roundPhase, RoundPhase.WordSelection);

    // word_selection timeout → drawing; промежуточный getRoomState сбрасывает очередь микрозадач
    timers.tick();
    await flushAsync();
    s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.roundPhase, RoundPhase.Drawing);
    assert.equal(s.leaderPlayerId, 'owner-id');

    // drawing timeout → round_end, ведущий сменился на p2
    timers.tick();
    await flushAsync();
    s = await getRoomState(redis, state.roomId);
    assert.ok(s);
    assert.equal(s.roundPhase, RoundPhase.RoundEnd);
    assert.equal(s.leaderPlayerId, 'p2');

    // round_end timeout → новый раунд word_selection, ведущий остаётся p2
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
