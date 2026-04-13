import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout } from 'node:timers';

import { GamePhase, RoundPhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { getRoomState, type RoomState } from '../../repositories/room-repository.js';
import type {
  GameNamespace,
  GameSocket,
  RoomEmitterTarget,
  SocketData,
} from '../../types/socket.js';
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

const makeNamespace = (sockets: GameSocket[]): GameNamespace =>
  ({
    in: (_roomId: string) => ({
      fetchSockets: async () => sockets,
    }),
  }) as unknown as GameNamespace;

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

  // Fires only the timer with the lowest ID (i.e. scheduled earliest)
  const tickFirst = (): void => {
    if (pending.size === 0) return;
    const firstId = Math.min(...pending.keys());
    const fn = pending.get(firstId)!;
    pending.delete(firstId);
    fn();
  };

  return { fakeSetTimeout, fakeClearTimeout, tick, tickFirst };
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
  word: '',
  wordMask: '',
  wordLength: 0,
  hintsUsed: 0,
  hintsTotal: 0,
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
    hintsCount: 0,
    language: 'ru',
    useCustomWordsOnly: false,
  },
  roundParticipantsCount: 2,
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

  it('при hintsCount=0 таймеры подсказок не планируются и hint_update не эмитится', async () => {
    const state = baseState({ totalMiniRounds: 1, miniRoundNumber: 0 });
    // hintsCount: 0 is already the default in baseState
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: state.roomId });
    // word_selection timeout → drawing (only drawing timer scheduled, no hint timers)
    timers.tick();
    await flushAsync();
    // drawing timeout → round_end
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

    // word_selection timeout → drawing; подменяем word и wordOptions в хранилище
    timers.tick();
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    assert.equal(afterStart.roundPhase, RoundPhase.Drawing);

    // Подменяем слово, чтобы знать точное значение
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterStart, word: 'кот', wordMask: '_ _ _', wordLength: 3 }),
    );

    // Первый pending таймер — подсказка (hint timer, ID ниже drawing timer)
    timers.tickFirst();
    await flushAsync();

    // Читаем состояние первым — это добавляет дополнительные микрозадачи,
    // необходимые для завершения handleHintTimeout перед проверкой событий
    const afterHint = await getRoomState(redis, state.roomId);
    assert.ok(afterHint);
    assert.equal(afterHint.hintsUsed, 1);

    // Должна быть раскрыта ровно одна буква из "кот"
    const maskChars = afterHint.wordMask.split(' ');
    const revealedCount = maskChars.filter((c) => c !== '_').length;
    assert.equal(revealedCount, 1);
    // Раскрытая буква должна быть из слова "кот"
    const wordChars = Array.from('кот');
    for (let i = 0; i < maskChars.length; i++) {
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
    timers.tick(); // word_selection timeout → drawing
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    // Подменяем слово с достаточной длиной (>= 3 символов) для 2 подсказок
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterStart, word: 'река', wordMask: '_ _ _ _', wordLength: 4 }),
    );

    // Первая подсказка
    timers.tickFirst();
    await flushAsync();

    const afterHint1 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint1);
    assert.equal(afterHint1.hintsUsed, 1);
    const revealed1 = afterHint1.wordMask.split(' ').filter((c) => c !== '_').length;
    assert.equal(revealed1, 1);

    // Вторая подсказка
    timers.tickFirst();
    await flushAsync();

    const afterHint2 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint2);
    assert.equal(afterHint2.hintsUsed, 2);
    const revealed2 = afterHint2.wordMask.split(' ').filter((c) => c !== '_').length;
    assert.equal(revealed2, 2);

    // Итого два hint_update
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
    timers.tick(); // word_selection timeout → drawing
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    // Подменяем слово "лес" с маской, где уже раскрыты 2 из 3 букв — остался 1 символ
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

    // Таймер подсказки срабатывает, но остался только 1 нераскрытый символ — маска не меняется
    timers.tickFirst();
    await flushAsync();

    const afterHint = await getRoomState(redis, state.roomId);
    assert.ok(afterHint);
    assert.equal(afterHint.wordMask, 'л е _');
    assert.equal(afterHint.hintsUsed, 2); // не изменился

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
    timers.tick(); // word_selection timeout → drawing
    await flushAsync();

    const afterStart = await getRoomState(redis, state.roomId);
    assert.ok(afterStart);
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterStart, word: 'море', wordMask: '_ _ _ _', wordLength: 4 }),
    );

    // Первая подсказка срабатывает нормально
    timers.tickFirst();
    await flushAsync();

    // Следующий таймер — вторая подсказка (второй hint timer).
    // Вместо её срабатывания — сначала симулируем завершение drawing через изменение фазы.
    // Сбрасываем фазу в round_end вручную, чтобы проверить что hint_timeout игнорируется.
    const afterHint1 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint1);
    storage.set(
      `skribbl:room:${state.roomId}`,
      JSON.stringify({ ...afterHint1, roundPhase: RoundPhase.RoundEnd }),
    );

    // Вторая подсказка срабатывает, но раунд уже в RoundEnd — ничего не делает
    timers.tickFirst();
    await flushAsync();

    const afterHint2 = await getRoomState(redis, state.roomId);
    assert.ok(afterHint2);
    assert.equal(afterHint2.hintsUsed, 1); // не изменился
    assert.equal(afterHint2.wordMask.split(' ').filter((c) => c !== '_').length, 1); // не изменился

    const hintEvents = roomEvents.filter((e) => e.event === 'hint_update');
    assert.equal(hintEvents.length, 1); // только первая подсказка
  });

  it('правильная догадка начисляет очки и эмитит score_update', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      roundEndAt: new Date(Date.now() + 80_000).toISOString(),
      roundParticipantsCount: 2,
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'p2' });

    await engine.handleGuess(socket, {
      roomId: state.roomId,
      messageId: 'msg-1',
      text: 'кот',
    });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    const p2 = savedState.players.find((p) => p.id === 'p2');
    const owner = savedState.players.find((p) => p.id === 'owner-id');
    assert.ok(p2);
    assert.ok(owner);
    assert.equal(p2.score, 103);
    assert.equal(owner.score, 60);
    assert.equal(p2.guessed, true);

    const guessEvent = roomEvents.find((e) => e.event === 'guess_result');
    assert.ok(guessEvent);
    const guessPayload = guessEvent.payload as {
      ok: true;
      result: string;
      awardedScore: number;
      position: number;
    };
    assert.equal(guessPayload.ok, true);
    assert.equal(guessPayload.result, 'correct');
    assert.equal(guessPayload.awardedScore, 100);
    assert.equal(guessPayload.position, 1);

    const scoreEvent = roomEvents.find((e) => e.event === 'score_update');
    assert.ok(scoreEvent);
    const scorePayload = scoreEvent.payload as {
      scores: Array<{ playerId: string; score: number }>;
    };
    assert.deepEqual(scorePayload.scores, [
      { playerId: 'owner-id', score: 60 },
      { playerId: 'p2', score: 103 },
    ]);
  });

  it('очки угадывающего учитывают четверть раунда по game_mechanics', async () => {
    const roundTimeSec = 80;
    // До конца 50 секунд из 80: прогресс 37.5%, значит timeFactor = 0.8.
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      roundEndAt: new Date(Date.now() + 50_000).toISOString(),
      roundParticipantsCount: 2,
      settings: {
        maxPlayers: 8,
        roundTimeSec,
        roundsCount: 1,
        wordChoicesCount: 3,
        hintsCount: 0,
        language: 'ru',
        useCustomWordsOnly: false,
      },
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'p2' });

    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-1', text: 'кот' });

    const guessEvent = roomEvents.find((e) => e.event === 'guess_result');
    assert.ok(guessEvent);
    const payload = guessEvent.payload as { awardedScore: number };
    assert.equal(payload.awardedScore, 80);
  });

  it('очки угадывающего учитывают подсказки и позицию угадывания', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      hintsUsed: 1,
      roundEndAt: new Date(Date.now() + 50_000).toISOString(),
      roundParticipantsCount: 3,
      players: [
        {
          id: 'owner-id',
          nickname: 'Owner',
          score: 10,
          isOwner: true,
          guessed: false,
          connectionStatus: 'connected',
          role: 'drawing',
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
        {
          id: 'p3',
          nickname: 'P3',
          score: 4,
          isOwner: false,
          guessed: true,
          connectionStatus: 'connected',
          role: 'guessing',
        },
      ],
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'p2' });

    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-2', text: 'кот' });

    const guessEvent = roomEvents.find((e) => e.event === 'guess_result');
    assert.ok(guessEvent);
    const payload = guessEvent.payload as { awardedScore: number; position: number };
    assert.equal(payload.position, 2);
    assert.equal(payload.awardedScore, 68);
  });

  it('неверная догадка не меняет очков и эмитит result=incorrect', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      roundEndAt: new Date(Date.now() + 80_000).toISOString(),
      roundParticipantsCount: 2,
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'p2' });

    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-1', text: 'пёс' });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    const p2 = savedState.players.find((p) => p.id === 'p2');
    assert.ok(p2);
    assert.equal(p2.score, 3);
    assert.equal(p2.guessed, false);

    const guessEvent = roomEvents.find((e) => e.event === 'guess_result');
    assert.ok(guessEvent);
    const payload = guessEvent.payload as { ok: true; result: string };
    assert.equal(payload.result, 'incorrect');

    const scoreEvent = roomEvents.find((e) => e.event === 'score_update');
    assert.equal(scoreEvent, undefined);
  });

  it('ведущий не может угадывать слово (blocked)', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      roundEndAt: new Date(Date.now() + 80_000).toISOString(),
      roundParticipantsCount: 2,
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

    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-1', text: 'кот' });

    assert.equal(socketEvents.length, 1);
    const payload = socketEvents[0]?.payload as { ok: true; result: string };
    assert.equal(payload.result, 'blocked');
  });

  it('уже угадавший игрок получает blocked', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      roundEndAt: new Date(Date.now() + 80_000).toISOString(),
      roundParticipantsCount: 2,
      players: [
        {
          id: 'owner-id',
          nickname: 'Owner',
          score: 10,
          isOwner: true,
          guessed: false,
          connectionStatus: 'connected',
          role: 'drawing',
        },
        {
          id: 'p2',
          nickname: 'P2',
          score: 3,
          isOwner: false,
          guessed: true,
          connectionStatus: 'connected',
          role: 'guessing',
        },
      ],
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket, events: socketEvents } = makeSocket({ roomId: state.roomId, playerId: 'p2' });

    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-1', text: 'кот' });

    assert.equal(socketEvents.length, 1);
    const payload = socketEvents[0]?.payload as { ok: true; result: string };
    assert.equal(payload.result, 'blocked');
  });

  it('когда все угадали — раунд завершается досрочно (all_guessed), ведущий получает бонус', async () => {
    const state = baseState({
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      miniRoundNumber: 1,
      totalMiniRounds: 2,
      word: 'кот',
      wordMask: '_ _ _',
      wordLength: 3,
      roundEndAt: new Date(Date.now() + 80_000).toISOString(),
      roundParticipantsCount: 2,
    });
    const { redis } = createInMemoryRedis(state);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: state.roomId, playerId: 'p2' });

    // p2 — единственный угадывающий; угадывает правильно
    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-1', text: 'кот' });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    assert.equal(savedState.roundPhase, RoundPhase.RoundEnd);

    // Ведущий получает 100 / 2 = 50 очков за угадывание в первой трети раунда.
    const owner = savedState.players.find((p) => p.id === 'owner-id');
    assert.ok(owner);
    assert.equal(owner.score, 60);

    const roundEndEvent = roomEvents.find((e) => e.event === 'round_end');
    assert.ok(roundEndEvent);
    const roundEndPayload = roundEndEvent.payload as { reason: string };
    assert.equal(roundEndPayload.reason, 'all_guessed');

    const wordRevealEvent = roomEvents.find((e) => e.event === 'word_reveal');
    assert.ok(wordRevealEvent);
    const wordRevealPayload = wordRevealEvent.payload as { leaderPlayerId: string };
    assert.equal(wordRevealPayload.leaderPlayerId, 'owner-id');
  });

  it('при истечении времени ведущий не получает повторный бонус, word_reveal содержит текущего лидера', async () => {
    // Подготавливаем состояние уже в фазе drawing с уже начисленным бонусом ведущему.
    const lobbyState = baseState({ totalMiniRounds: 2, roundParticipantsCount: 2 });
    const { redis, storage } = createInMemoryRedis(lobbyState);
    const { roomEmitterTarget, events: roomEvents } = makeRoomEmitter();
    const timers = makeFakeTimers();
    const engine = new GameEngine(redis, roomEmitterTarget, {
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });
    const { socket } = makeSocket({ roomId: lobbyState.roomId, playerId: 'owner-id' });

    await engine.handleStartGame(socket, { roomId: lobbyState.roomId });

    // word_selection timeout → drawing
    timers.tickFirst();
    await flushAsync();

    // Подменяем состояние: p2 уже угадал, а бонус ведущему уже был начислен ранее.
    const drawingState = await getRoomState(redis, lobbyState.roomId);
    assert.ok(drawingState);
    storage.set(
      `skribbl:room:${lobbyState.roomId}`,
      JSON.stringify({
        ...drawingState,
        word: 'кот',
        roundParticipantsCount: 2,
        players: drawingState.players.map((p) =>
          p.id === 'owner-id' ? { ...p, score: 60 } : p.id === 'p2' ? { ...p, guessed: true } : p,
        ),
      }),
    );

    // drawing timeout → round_end
    timers.tickFirst();
    await flushAsync();

    const finalState = await getRoomState(redis, lobbyState.roomId);
    assert.ok(finalState);
    assert.equal(finalState.roundPhase, RoundPhase.RoundEnd);

    const owner = finalState.players.find((p) => p.id === 'owner-id');
    assert.ok(owner);
    assert.equal(owner.score, 60);

    const wordReveal = roomEvents.find((e) => e.event === 'word_reveal');
    assert.ok(wordReveal, 'word_reveal должен быть эмитирован');
    const wordRevealPayload = wordReveal.payload as { leaderPlayerId: string };
    assert.equal(wordRevealPayload.leaderPlayerId, 'owner-id');

    const scoreUpdate = roomEvents.find((e) => e.event === 'score_update');
    assert.ok(scoreUpdate, 'score_update должен быть эмитирован');
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
