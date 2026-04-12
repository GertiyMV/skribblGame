import {
  GamePhase,
  ROUND_END_DURATION_MS,
  RoundPhase,
  WORD_SELECTION_DURATION_MS,
  type ClientToServerEventPayloads,
} from '@skribbl/shared';
import { clearTimeout, setTimeout } from 'node:timers';
import type { RedisClientType } from 'redis';

import { getRoomState, saveRoomState, type RoomState } from '../../repositories/room-repository.js';
import type { GameSocket, RoomEmitterTarget } from '../../types/socket.js';
import { emitToRoom, emitToSocket } from '../../transport/socket/emitter.js';
import {
  createGameOverEvent,
  createHintUpdateEvent,
  createJoinErrorEvent,
  createRoundEndEvent,
  createRoundStartEvent,
} from '../../transport/socket/event-factories.js';

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (callback: () => void, ms: number) => TimerHandle;
type ClearTimeoutFn = (handle: TimerHandle) => void;

interface RoomTimerState {
  wordSelectionTimer: TimerHandle | null;
  drawingTimer: TimerHandle | null;
  roundEndTimer: TimerHandle | null;
  hintTimers: TimerHandle[];
}

const WORD_BANK = {
  easy: [
    'кот',
    'дом',
    'лес',
    'река',
    'рыба',
    'небо',
    'звезда',
    'цветок',
    'книга',
    'стол',
    'стул',
    'мяч',
    'солнце',
    'луна',
    'море',
    'гора',
    'снег',
    'дождь',
    'хлеб',
    'молоко',
  ],
  medium: [
    'велосипед',
    'самолёт',
    'корабль',
    'автобус',
    'поезд',
    'радуга',
    'облако',
    'фонтан',
    'замок',
    'маяк',
    'мост',
    'башня',
    'корона',
    'зонт',
    'очки',
    'гитара',
    'пианино',
    'ракета',
    'планета',
    'робот',
  ],
  hard: [
    'библиотека',
    'телескоп',
    'микроскоп',
    'акробат',
    'вулкан',
    'лабиринт',
    'пирамида',
    'водопад',
    'карусель',
    'шахматы',
    'архитектор',
    'парашют',
    'эскалатор',
    'трамплин',
    'аквариум',
    'метрополитен',
    'обсерватория',
    'бумеранг',
    'экскаватор',
    'скалолаз',
  ],
} as const;

const makeMask = (word: string): string =>
  Array.from(word)
    .map(() => '_')
    .join(' ');

const buildDrawingState = (state: RoomState): RoomState => ({
  ...state,
  players: state.players.map((player) => ({
    ...player,
    guessed: false,
    role: player.id === state.leaderPlayerId ? 'drawing' : 'guessing',
  })),
});

const getCurrentPlayer = (state: RoomState, playerId: string) =>
  state.players.find((player) => player.id === playerId);

const getNextLeaderPlayerId = (state: RoomState): string => {
  const currentIndex = state.players.findIndex((player) => player.id === state.leaderPlayerId);
  if (currentIndex < 0 || state.players.length === 0) {
    return state.leaderPlayerId;
  }

  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (currentIndex + offset) % state.players.length;
    const candidate = state.players[index];
    if (candidate && candidate.connectionStatus === 'connected') {
      return candidate.id;
    }
  }

  return state.leaderPlayerId;
};

const getWinners = (state: RoomState): string[] => {
  const maxScore = Math.max(...state.players.map((player) => player.score));
  return state.players.filter((player) => player.score === maxScore).map((player) => player.id);
};

const pickRandom = <T>(array: readonly T[]): T | undefined =>
  array[Math.floor(Math.random() * array.length)];

const buildWordOptions = (count: number): string[] => {
  const targetCount = Math.max(1, Math.floor(count));
  const allWords = [...WORD_BANK.easy, ...WORD_BANK.medium, ...WORD_BANK.hard];
  const uniqueWords = [...new Set(allWords)];
  const shuffled = [...uniqueWords].sort(() => Math.random() - 0.5);

  return shuffled.slice(0, Math.min(targetCount, shuffled.length));
};

export class GameEngine {
  private readonly roomTimers = new Map<string, RoomTimerState>();
  private readonly redis: RedisClientType;
  private readonly roomEmitterTarget: RoomEmitterTarget;
  private readonly scheduleTimer: SetTimeoutFn;
  private readonly cancelTimer: ClearTimeoutFn;

  constructor(
    redis: RedisClientType,
    roomEmitterTarget: RoomEmitterTarget,
    timerFns: { setTimeout?: SetTimeoutFn; clearTimeout?: ClearTimeoutFn } = {},
  ) {
    this.redis = redis;
    this.roomEmitterTarget = roomEmitterTarget;
    this.scheduleTimer = timerFns.setTimeout ?? setTimeout;
    this.cancelTimer = timerFns.clearTimeout ?? clearTimeout;
  }

  /**
   * Запускает игру и переводит комнату из lobby в in_game/word_selection.
   */
  async handleStartGame(
    socket: GameSocket,
    payload: ClientToServerEventPayloads['start_game'],
  ): Promise<void> {
    const { playerId, roomId: socketRoomId } = socket.data;
    if (!playerId || socketRoomId !== payload.roomId) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: payload.roomId,
          code: 'forbidden_action',
          message: 'Invalid room context',
        }),
      );
      return;
    }

    const state = await getRoomState(this.redis, payload.roomId);
    if (!state) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: payload.roomId,
          code: 'room_not_found',
          message: 'Room not found',
        }),
      );
      return;
    }

    const currentPlayer = getCurrentPlayer(state, playerId);
    if (!currentPlayer?.isOwner) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'forbidden_action',
          message: 'Only room owner can start the game',
        }),
      );
      return;
    }

    if (state.phase !== GamePhase.Lobby || state.roundPhase !== RoundPhase.RoundEnd) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'forbidden_action',
          message: 'Invalid phase transition: lobby -> word_selection',
        }),
      );
      return;
    }

    if (state.players.length < 2) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'forbidden_action',
          message: 'At least two players are required',
        }),
      );
      return;
    }

    const selectionDeadline = new Date(Date.now() + WORD_SELECTION_DURATION_MS).toISOString();
    const updatedState: RoomState = {
      ...state,
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.WordSelection,
      miniRoundNumber: state.miniRoundNumber === 0 ? 1 : state.miniRoundNumber,
      roundEndAt: selectionDeadline,
      wordOptions: buildWordOptions(state.settings.wordChoicesCount),
      wordMask: '',
      wordLength: 0,
      hintsUsed: 0,
      players: state.players.map((player) => ({
        ...player,
        guessed: false,
        role: player.id === state.leaderPlayerId ? 'drawing' : 'guessing',
      })),
    };

    await saveRoomState(this.redis, updatedState);
    emitToRoom(
      this.roomEmitterTarget,
      updatedState.roomId,
      'round_start',
      createRoundStartEvent(updatedState),
    );

    this.scheduleWordSelectionTimeout(updatedState.roomId, updatedState.miniRoundNumber);
  }

  /**
   * Обрабатывает выбор слова ведущим и переводит раунд в drawing.
   */
  async handleChooseWord(
    socket: GameSocket,
    payload: ClientToServerEventPayloads['choose_word'],
  ): Promise<void> {
    const { playerId, roomId: socketRoomId } = socket.data;
    if (!playerId || socketRoomId !== payload.roomId) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: payload.roomId,
          code: 'forbidden_action',
          message: 'Invalid room context',
        }),
      );
      return;
    }

    const state = await getRoomState(this.redis, payload.roomId);
    if (!state) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: payload.roomId,
          code: 'room_not_found',
          message: 'Room not found',
        }),
      );
      return;
    }

    if (state.phase !== GamePhase.InGame || state.roundPhase !== RoundPhase.WordSelection) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'forbidden_action',
          message: 'Invalid phase transition: word_selection -> drawing',
        }),
      );
      return;
    }

    if (state.leaderPlayerId !== playerId) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'forbidden_action',
          message: 'Only current leader can choose word',
        }),
      );
      return;
    }

    if (!state.wordOptions.includes(payload.word)) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'invalid_payload',
          message: 'Chosen word is not in available options',
        }),
      );
      return;
    }

    await this.transitionToDrawing(state, payload.word);
  }

  private getOrCreateRoomTimers(roomId: string): RoomTimerState {
    let timers = this.roomTimers.get(roomId);
    if (!timers) {
      timers = {
        wordSelectionTimer: null,
        drawingTimer: null,
        roundEndTimer: null,
        hintTimers: [],
      };
      this.roomTimers.set(roomId, timers);
    }
    return timers;
  }

  private clearRoomTimers(roomId: string): void {
    const timers = this.roomTimers.get(roomId);
    if (!timers) {
      return;
    }

    if (timers.wordSelectionTimer) {
      this.cancelTimer(timers.wordSelectionTimer);
    }
    if (timers.drawingTimer) {
      this.cancelTimer(timers.drawingTimer);
    }
    if (timers.roundEndTimer) {
      this.cancelTimer(timers.roundEndTimer);
    }
    for (const handle of timers.hintTimers) {
      this.cancelTimer(handle);
    }

    this.roomTimers.delete(roomId);
  }

  private clearHintTimers(roomId: string): void {
    const timers = this.roomTimers.get(roomId);
    if (!timers) {
      return;
    }
    for (const handle of timers.hintTimers) {
      this.cancelTimer(handle);
    }
    timers.hintTimers = [];
  }

  private scheduleWordSelectionTimeout(roomId: string, miniRoundNumber: number): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.wordSelectionTimer) {
      this.cancelTimer(timers.wordSelectionTimer);
    }

    timers.wordSelectionTimer = this.scheduleTimer(() => {
      void this.handleWordSelectionTimeout(roomId, miniRoundNumber);
    }, WORD_SELECTION_DURATION_MS);
  }

  private scheduleDrawingTimeout(
    roomId: string,
    miniRoundNumber: number,
    roundTimeSec: number,
  ): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.drawingTimer) {
      this.cancelTimer(timers.drawingTimer);
    }

    timers.drawingTimer = this.scheduleTimer(() => {
      void this.handleDrawingTimeout(roomId, miniRoundNumber);
    }, roundTimeSec * 1000);
  }

  private scheduleRoundEndTimeout(roomId: string, miniRoundNumber: number): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.roundEndTimer) {
      this.cancelTimer(timers.roundEndTimer);
    }

    timers.roundEndTimer = this.scheduleTimer(() => {
      void this.handleRoundEndTimeout(roomId, miniRoundNumber);
    }, ROUND_END_DURATION_MS);
  }

  private scheduleHintTimers(
    roomId: string,
    miniRoundNumber: number,
    roundTimeSec: number,
    hintsTotal: number,
  ): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    for (const handle of timers.hintTimers) {
      this.cancelTimer(handle);
    }
    timers.hintTimers = [];

    for (let i = 0; i < hintsTotal; i++) {
      const delayMs = Math.floor(((i + 1) / (hintsTotal + 1)) * roundTimeSec * 1000);
      const handle = this.scheduleTimer(() => {
        void this.handleHintTimeout(roomId, miniRoundNumber);
      }, delayMs);
      timers.hintTimers.push(handle);
    }
  }

  private revealHint(word: string, mask: string): string {
    const chars = mask.split(' ');
    const unrevealedIndices = chars.reduce<number[]>((acc, char, index) => {
      if (char === '_') acc.push(index);
      return acc;
    }, []);

    // Keep at least one character unrevealed
    if (unrevealedIndices.length <= 1) {
      return mask;
    }

    const randomIndex = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)]!;
    const wordChars = Array.from(word);
    const updated = [...chars];
    updated[randomIndex] = wordChars[randomIndex]!;

    return updated.join(' ');
  }

  private async handleHintTimeout(roomId: string, miniRoundNumber: number): Promise<void> {
    const state = await getRoomState(this.redis, roomId);
    if (!state) {
      return;
    }

    if (
      state.phase !== GamePhase.InGame ||
      state.roundPhase !== RoundPhase.Drawing ||
      state.miniRoundNumber !== miniRoundNumber
    ) {
      return;
    }

    const newMask = this.revealHint(state.word, state.wordMask);
    if (newMask === state.wordMask) {
      return;
    }

    const updatedState: RoomState = {
      ...state,
      wordMask: newMask,
      hintsUsed: state.hintsUsed + 1,
    };

    await saveRoomState(this.redis, updatedState);
    emitToRoom(this.roomEmitterTarget, roomId, 'hint_update', createHintUpdateEvent(updatedState));
  }

  private async handleWordSelectionTimeout(roomId: string, miniRoundNumber: number): Promise<void> {
    const state = await getRoomState(this.redis, roomId);
    if (!state) {
      return;
    }

    if (
      state.phase !== GamePhase.InGame ||
      state.roundPhase !== RoundPhase.WordSelection ||
      state.miniRoundNumber !== miniRoundNumber
    ) {
      return;
    }

    const autoSelectedWord = pickRandom(state.wordOptions) ?? pickRandom(WORD_BANK.easy) ?? 'кот';
    await this.transitionToDrawing(state, autoSelectedWord);
  }

  private async transitionToDrawing(state: RoomState, chosenWord: string): Promise<void> {
    const timers = this.getOrCreateRoomTimers(state.roomId);
    if (timers.wordSelectionTimer) {
      this.cancelTimer(timers.wordSelectionTimer);
      timers.wordSelectionTimer = null;
    }

    const roundEndAt = new Date(Date.now() + state.settings.roundTimeSec * 1000).toISOString();
    const drawingState: RoomState = {
      ...buildDrawingState(state),
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.Drawing,
      roundEndAt,
      word: chosenWord,
      wordOptions: [],
      wordMask: makeMask(chosenWord),
      wordLength: Array.from(chosenWord).length,
      hintsUsed: 0,
    };

    await saveRoomState(this.redis, drawingState);
    emitToRoom(
      this.roomEmitterTarget,
      drawingState.roomId,
      'round_start',
      createRoundStartEvent(drawingState),
    );
    this.scheduleHintTimers(
      drawingState.roomId,
      drawingState.miniRoundNumber,
      drawingState.settings.roundTimeSec,
      drawingState.hintsTotal,
    );
    this.scheduleDrawingTimeout(
      drawingState.roomId,
      drawingState.miniRoundNumber,
      drawingState.settings.roundTimeSec,
    );
  }

  private async handleDrawingTimeout(roomId: string, miniRoundNumber: number): Promise<void> {
    const state = await getRoomState(this.redis, roomId);
    if (!state) {
      return;
    }

    if (
      state.phase !== GamePhase.InGame ||
      state.roundPhase !== RoundPhase.Drawing ||
      state.miniRoundNumber !== miniRoundNumber
    ) {
      return;
    }

    this.clearHintTimers(roomId);

    const nextLeaderPlayerId = getNextLeaderPlayerId(state);
    const roundEndAt = new Date(Date.now() + ROUND_END_DURATION_MS).toISOString();
    const roundEndState: RoomState = {
      ...state,
      roundPhase: RoundPhase.RoundEnd,
      roundEndAt,
      leaderPlayerId: nextLeaderPlayerId,
      players: state.players.map((player) => ({
        ...player,
        role: player.id === nextLeaderPlayerId ? 'drawing' : 'guessing',
      })),
    };

    await saveRoomState(this.redis, roundEndState);
    emitToRoom(
      this.roomEmitterTarget,
      roundEndState.roomId,
      'round_end',
      createRoundEndEvent(roundEndState, 'time_over', nextLeaderPlayerId),
    );

    this.scheduleRoundEndTimeout(roundEndState.roomId, roundEndState.miniRoundNumber);
  }

  private async handleRoundEndTimeout(roomId: string, miniRoundNumber: number): Promise<void> {
    const state = await getRoomState(this.redis, roomId);
    if (!state) {
      return;
    }

    if (
      state.phase !== GamePhase.InGame ||
      state.roundPhase !== RoundPhase.RoundEnd ||
      state.miniRoundNumber !== miniRoundNumber
    ) {
      return;
    }

    if (state.miniRoundNumber >= state.totalMiniRounds) {
      const gameOverState: RoomState = {
        ...state,
        phase: GamePhase.GameOver,
        roundPhase: RoundPhase.RoundEnd,
      };

      await saveRoomState(this.redis, gameOverState);
      emitToRoom(
        this.roomEmitterTarget,
        gameOverState.roomId,
        'game_over',
        createGameOverEvent(gameOverState, getWinners(gameOverState)),
      );
      this.clearRoomTimers(gameOverState.roomId);
      return;
    }

    const selectionDeadline = new Date(Date.now() + WORD_SELECTION_DURATION_MS).toISOString();
    const nextState: RoomState = {
      ...state,
      phase: GamePhase.InGame,
      roundPhase: RoundPhase.WordSelection,
      miniRoundNumber: state.miniRoundNumber + 1,
      roundEndAt: selectionDeadline,
      wordOptions: buildWordOptions(state.settings.wordChoicesCount),
      wordMask: '',
      wordLength: 0,
      hintsUsed: 0,
    };

    await saveRoomState(this.redis, nextState);
    emitToRoom(
      this.roomEmitterTarget,
      nextState.roomId,
      'round_start',
      createRoundStartEvent(nextState),
    );
    this.scheduleWordSelectionTimeout(nextState.roomId, nextState.miniRoundNumber);
  }
}
