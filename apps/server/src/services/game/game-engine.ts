import {
  GamePhase,
  ROUND_END_DURATION_MS,
  RoundPhase,
  WORD_SELECTION_DURATION_MS,
  type ClientToServerEventPayloads,
  type PlayerId,
  type RoomId,
  type Score,
  type Word,
} from '@skribbl/shared';
import { clearTimeout, setTimeout } from 'node:timers';
import type { RedisClientType } from 'redis';

import { getRoomState, saveRoomState } from '../../repositories/room-repository.js';
import type { RoomState } from '../../types/types-game.js';
import type { GameNamespace, GameSocket, RoomEmitterTarget } from '../../types/types-socket.js';
import { emitToRoom, emitToSocket } from '../../transport/socket/emitter.js';
import {
  createGameOverEvent,
  createGuessResultEvent,
  createHintUpdateEvent,
  createJoinErrorEvent,
  createRoundEndEvent,
  createRoundStartEvent,
  createScoreUpdateEvent,
  createWordRevealEvent,
} from '../../transport/socket/event-factories.js';
import { WordService } from '../word-service/word-service.js';

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (callback: () => void, ms: number) => TimerHandle;
type ClearTimeoutFn = (handle: TimerHandle) => void;

interface RoomTimerState {
  wordSelectionTimer: TimerHandle | null;
  drawingTimer: TimerHandle | null;
  roundEndTimer: TimerHandle | null;
  hintTimers: TimerHandle[];
}

const makeMask = (word: string): string =>
  Array.from(word)
    .map(() => '_')
    .join(' ');

const getRoundProgress = (remainingTimeSec: number, roundTimeSec: number): number =>
  Math.min(1, Math.max(0, (roundTimeSec - remainingTimeSec) / roundTimeSec));

const getGuesserTimeFactor = (progress: number): number => {
  if (progress < 0.25) {
    return 1;
  }
  if (progress < 0.5) {
    return 0.8;
  }
  if (progress < 0.75) {
    return 0.6;
  }
  return 0.4;
};

const getGuesserPositionBonus = (position: number): number => {
  if (position <= 1) {
    return 1;
  }
  if (position === 2) {
    return 0.9;
  }
  if (position === 3) {
    return 0.8;
  }
  return 0.7;
};

const calculateGuesserScore = (
  remainingTimeSec: number,
  roundTimeSec: number,
  hintsUsed: number,
  position: number,
): Score => {
  const progress = getRoundProgress(remainingTimeSec, roundTimeSec);
  const timeFactor = getGuesserTimeFactor(progress);
  const hintPenaltyFactor = Math.max(0, 1 - 0.05 * hintsUsed);
  const positionBonus = getGuesserPositionBonus(position);

  return Math.min(
    100,
    Math.max(5, Math.round(100 * timeFactor * hintPenaltyFactor * positionBonus)),
  );
};

const calculateLeaderContribution = (
  remainingTimeSec: number,
  roundTimeSec: number,
  roundParticipantsCount: number,
): Score => {
  const progress = getRoundProgress(remainingTimeSec, roundTimeSec);
  const timeFactor = progress < 1 / 3 ? 1 : progress < 2 / 3 ? 0.7 : 0.5;
  const leaderPerGuess = 100 / Math.max(1, roundParticipantsCount);

  return Math.round(leaderPerGuess * timeFactor);
};

const buildDrawingState = (state: RoomState): RoomState => ({
  ...state,
  players: state.players.map((player) => ({
    ...player,
    guessed: false,
    role: player.id === state.leaderPlayerId ? 'drawing' : 'guessing',
  })),
});

const getCurrentPlayer = (state: RoomState, playerId: PlayerId) =>
  state.players.find((player) => player.id === playerId);

const getNextLeaderPlayerId = (state: RoomState): PlayerId => {
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

const getWinners = (state: RoomState): PlayerId[] => {
  const maxScore = Math.max(...state.players.map((player) => player.score));
  return state.players.filter((player) => player.score === maxScore).map((player) => player.id);
};

const pickRandom = <T>(array: readonly T[]): T | undefined =>
  array[Math.floor(Math.random() * array.length)];

export class GameEngine {
  private readonly roomTimers = new Map<RoomId, RoomTimerState>();
  private readonly redis: RedisClientType;
  private readonly roomEmitterTarget: RoomEmitterTarget;
  private readonly scheduleTimer: SetTimeoutFn;
  private readonly cancelTimer: ClearTimeoutFn;
  private readonly namespace?: GameNamespace;
  private readonly wordService: WordService;

  constructor(
    redis: RedisClientType,
    roomEmitterTarget: RoomEmitterTarget,
    timerFns: {
      setTimeout?: SetTimeoutFn;
      clearTimeout?: ClearTimeoutFn;
      namespace?: GameNamespace;
      wordService?: WordService;
    } = {},
  ) {
    this.redis = redis;
    this.roomEmitterTarget = roomEmitterTarget;
    this.scheduleTimer = timerFns.setTimeout ?? setTimeout;
    this.cancelTimer = timerFns.clearTimeout ?? clearTimeout;
    this.namespace = timerFns.namespace;
    this.wordService = timerFns.wordService ?? new WordService();
  }

  private async emitRoundStart(state: RoomState): Promise<void> {
    if (state.roundPhase !== RoundPhase.WordSelection || !this.namespace) {
      emitToRoom(this.roomEmitterTarget, state.roomId, 'round_start', createRoundStartEvent(state));
      return;
    }

    const sockets = await this.namespace.in(state.roomId).fetchSockets();
    const leaderPayload = createRoundStartEvent(state, { wordOptions: state.wordOptions });
    const guessingPayload = createRoundStartEvent(state, { wordOptions: [] });

    for (const roomSocket of sockets) {
      emitToSocket(
        roomSocket as unknown as GameSocket,
        'round_start',
        roomSocket.data.playerId === state.leaderPlayerId ? leaderPayload : guessingPayload,
      );
    }
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
      wordOptions: this.wordService.getWordOptions(
        state.settings.wordChoicesCount,
        state.settings.wordDifficulty,
        [],
      ),
      usedWords: [],
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
    await this.emitRoundStart(updatedState);

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

  private getOrCreateRoomTimers(roomId: RoomId): RoomTimerState {
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

  private clearRoomTimers(roomId: RoomId): void {
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

  private clearHintTimers(roomId: RoomId): void {
    const timers = this.roomTimers.get(roomId);
    if (!timers) {
      return;
    }
    for (const handle of timers.hintTimers) {
      this.cancelTimer(handle);
    }
    timers.hintTimers = [];
  }

  private scheduleWordSelectionTimeout(roomId: RoomId, miniRoundNumber: number): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.wordSelectionTimer) {
      this.cancelTimer(timers.wordSelectionTimer);
    }

    timers.wordSelectionTimer = this.scheduleTimer(() => {
      void this.handleWordSelectionTimeout(roomId, miniRoundNumber);
    }, WORD_SELECTION_DURATION_MS);
  }

  private scheduleDrawingTimeout(
    roomId: RoomId,
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

  private scheduleRoundEndTimeout(roomId: RoomId, miniRoundNumber: number): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.roundEndTimer) {
      this.cancelTimer(timers.roundEndTimer);
    }

    timers.roundEndTimer = this.scheduleTimer(() => {
      void this.handleRoundEndTimeout(roomId, miniRoundNumber);
    }, ROUND_END_DURATION_MS);
  }

  private scheduleHintTimers(
    roomId: RoomId,
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

  private async handleHintTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
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

  private async handleWordSelectionTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
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

    const autoSelectedWord =
      pickRandom(state.wordOptions) ??
      this.wordService.pickFallbackWord(state.settings.wordDifficulty);
    await this.transitionToDrawing(state, autoSelectedWord);
  }

  private async transitionToDrawing(state: RoomState, chosenWord: Word): Promise<void> {
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
      usedWords: [...(state.usedWords ?? []), chosenWord],
      wordOptions: [],
      wordMask: makeMask(chosenWord),
      wordLength: Array.from(chosenWord).length,
      hintsUsed: 0,
      roundParticipantsCount: state.players.filter(
        (player) => player.connectionStatus === 'connected',
      ).length,
    };

    await saveRoomState(this.redis, drawingState);
    await this.emitRoundStart(drawingState);
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

  private async handleDrawingTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
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
      'score_update',
      createScoreUpdateEvent(roundEndState),
    );
    emitToRoom(
      this.roomEmitterTarget,
      roundEndState.roomId,
      'word_reveal',
      createWordRevealEvent({
        roomId: state.roomId,
        word: state.word,
        leaderPlayerId: state.leaderPlayerId,
      }),
    );
    emitToRoom(
      this.roomEmitterTarget,
      roundEndState.roomId,
      'round_end',
      createRoundEndEvent(roundEndState, 'time_over', nextLeaderPlayerId),
    );

    this.scheduleRoundEndTimeout(roundEndState.roomId, roundEndState.miniRoundNumber);
  }

  /**
   * Обрабатывает попытку угадать слово.
   */
  async handleGuess(
    socket: GameSocket,
    payload: ClientToServerEventPayloads['guess'],
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

    if (state.phase !== GamePhase.InGame || state.roundPhase !== RoundPhase.Drawing) {
      emitToSocket(
        socket,
        'guess_result',
        createGuessResultEvent({
          roomId: state.roomId,
          playerId,
          messageId: payload.messageId,
          result: 'blocked',
        }),
      );
      return;
    }

    const currentPlayer = getCurrentPlayer(state, playerId);
    if (!currentPlayer) {
      emitToSocket(
        socket,
        'guess_result',
        createJoinErrorEvent({
          roomId: state.roomId,
          code: 'forbidden_action',
          message: 'Player not found in room',
        }),
      );
      return;
    }

    if (currentPlayer.id === state.leaderPlayerId || currentPlayer.guessed) {
      emitToSocket(
        socket,
        'guess_result',
        createGuessResultEvent({
          roomId: state.roomId,
          playerId,
          messageId: payload.messageId,
          result: 'blocked',
        }),
      );
      return;
    }

    const isCorrect = payload.text.trim().toLowerCase() === state.word.toLowerCase();

    if (!isCorrect) {
      emitToRoom(
        this.roomEmitterTarget,
        state.roomId,
        'guess_result',
        createGuessResultEvent({
          roomId: state.roomId,
          playerId,
          messageId: payload.messageId,
          result: 'incorrect',
        }),
      );
      return;
    }

    const correctGuessersBeforeThis = state.players.filter(
      (p) => p.guessed && p.id !== state.leaderPlayerId,
    );
    const position = correctGuessersBeforeThis.length + 1;

    const roundEndTimestamp = new Date(state.roundEndAt).getTime();
    const remainingTimeSec = Math.max(0, (roundEndTimestamp - Date.now()) / 1000);
    const awardedScore = calculateGuesserScore(
      remainingTimeSec,
      state.settings.roundTimeSec,
      state.hintsUsed,
      position,
    );
    const leaderContribution = calculateLeaderContribution(
      remainingTimeSec,
      state.settings.roundTimeSec,
      state.roundParticipantsCount,
    );

    const updatedState: RoomState = {
      ...state,
      players: state.players.map((p) =>
        p.id === playerId
          ? { ...p, score: p.score + awardedScore, guessed: true }
          : p.id === state.leaderPlayerId
            ? { ...p, score: p.score + leaderContribution }
            : p,
      ),
    };

    await saveRoomState(this.redis, updatedState);

    emitToRoom(
      this.roomEmitterTarget,
      state.roomId,
      'guess_result',
      createGuessResultEvent({
        roomId: state.roomId,
        playerId,
        messageId: payload.messageId,
        result: 'correct',
        awardedScore,
        position,
      }),
    );

    emitToRoom(
      this.roomEmitterTarget,
      state.roomId,
      'score_update',
      createScoreUpdateEvent(updatedState),
    );

    const guessers = updatedState.players.filter(
      (p) => p.id !== updatedState.leaderPlayerId && p.connectionStatus === 'connected',
    );
    if (guessers.length > 0 && guessers.every((p) => p.guessed)) {
      await this.endRoundAllGuessed(updatedState);
    }
  }

  private async endRoundAllGuessed(state: RoomState): Promise<void> {
    this.clearHintTimers(state.roomId);
    const timers = this.getOrCreateRoomTimers(state.roomId);
    if (timers.drawingTimer) {
      this.cancelTimer(timers.drawingTimer);
      timers.drawingTimer = null;
    }

    const nextLeaderPlayerId = getNextLeaderPlayerId(state);
    const roundEndAt = new Date(Date.now() + ROUND_END_DURATION_MS).toISOString();

    const roundEndState: RoomState = {
      ...state,
      roundPhase: RoundPhase.RoundEnd,
      roundEndAt,
      leaderPlayerId: nextLeaderPlayerId,
      players: state.players.map((p) => ({
        ...p,
        role: p.id === nextLeaderPlayerId ? 'drawing' : 'guessing',
      })),
    };

    await saveRoomState(this.redis, roundEndState);

    emitToRoom(
      this.roomEmitterTarget,
      state.roomId,
      'score_update',
      createScoreUpdateEvent(roundEndState),
    );
    emitToRoom(
      this.roomEmitterTarget,
      state.roomId,
      'word_reveal',
      createWordRevealEvent({
        roomId: state.roomId,
        word: state.word,
        leaderPlayerId: state.leaderPlayerId,
      }),
    );
    emitToRoom(
      this.roomEmitterTarget,
      state.roomId,
      'round_end',
      createRoundEndEvent(roundEndState, 'all_guessed', nextLeaderPlayerId),
    );

    this.scheduleRoundEndTimeout(state.roomId, state.miniRoundNumber);
  }

  private async handleRoundEndTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
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
      wordOptions: this.wordService.getWordOptions(
        state.settings.wordChoicesCount,
        state.settings.wordDifficulty,
        state.usedWords ?? [],
      ),
      wordMask: '',
      wordLength: 0,
      hintsUsed: 0,
    };

    await saveRoomState(this.redis, nextState);
    await this.emitRoundStart(nextState);
    this.scheduleWordSelectionTimeout(nextState.roomId, nextState.miniRoundNumber);
  }
}
