import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GamePhase, RoundPhase } from '@skribbl/shared';

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

describe('GameEngine guessing', () => {
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
        wordDifficulty: 'medium',
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

    await engine.handleGuess(socket, { roomId: state.roomId, messageId: 'msg-1', text: 'кот' });

    const savedState = await getRoomState(redis, state.roomId);
    assert.ok(savedState);
    assert.equal(savedState.roundPhase, RoundPhase.RoundEnd);

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

    timers.tickFirst();
    await flushAsync();

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
});
