import {
  GamePhase,
  RoundPhase,
  type ClientToServerEventPayloads,
  type RoomId,
} from '@skribbl/shared';

import { getRoomState, saveRoomState } from '../../repositories/room-repository.js';
import { emitToRoom, emitToSocket } from '../../transport/socket/emitter.js';
import {
  createGameOverEvent,
  createJoinErrorEvent,
} from '../../transport/socket/event-factories.js';
import type { RoomState } from '../../types/types-game.js';
import type { GameSocket } from '../../types/types-socket.js';
import type { GameEngineContext } from './game-engine-context.js';
import {
  createDrawingState,
  createGameOverState,
  createNextWordSelectionState,
  createWordSelectionState,
} from './game-phase-state.js';
import { getCurrentPlayer, getWinners, pickRandom } from './game-state-helpers.js';
import { emitRoundStart } from './game-round-start.js';
import {
  emitInvalidRoomContextError,
  getRoomStateOrEmitError,
  hasValidRoomContext,
} from './game-request-guards.js';
import { finalizeRoundEnd } from './round-end-flow.js';
import type { Word } from '@skribbl/shared';

interface DrawingPhaseCallbacks {
  onHintTimeout: (roomId: RoomId, miniRoundNumber: number) => void;
  onDrawingTimeout: (roomId: RoomId, miniRoundNumber: number) => void;
}

/**
 * Starts the game and moves the room into `word_selection`.
 */
export const handleStartGame = async (
  context: GameEngineContext,
  socket: GameSocket,
  payload: ClientToServerEventPayloads['start_game'],
  onWordSelectionTimeout: (roomId: RoomId, miniRoundNumber: number) => void,
): Promise<void> => {
  const { playerId } = socket.data;
  if (!hasValidRoomContext(socket, payload.roomId)) {
    emitInvalidRoomContextError(socket, payload.roomId);
    return;
  }

  const state = await getRoomStateOrEmitError(context.redis, socket, payload.roomId);
  if (!state) {
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

  const updatedState = createWordSelectionState(context, state);

  await saveRoomState(context.redis, updatedState);
  await emitRoundStart(context, updatedState);

  context.roomTimers.scheduleWordSelectionTimeout(updatedState.roomId, () => {
    onWordSelectionTimeout(updatedState.roomId, updatedState.miniRoundNumber);
  });
};

/**
 * Applies the leader's chosen word and moves the room into `drawing`.
 */
export const handleChooseWord = async (
  context: GameEngineContext,
  socket: GameSocket,
  payload: ClientToServerEventPayloads['choose_word'],
  callbacks: DrawingPhaseCallbacks,
): Promise<void> => {
  const { playerId } = socket.data;
  if (!hasValidRoomContext(socket, payload.roomId)) {
    emitInvalidRoomContextError(socket, payload.roomId);
    return;
  }

  const state = await getRoomStateOrEmitError(context.redis, socket, payload.roomId);
  if (!state) {
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

  await transitionToDrawing(context, state, payload.word, callbacks);
};

/**
 * Auto-selects a word when the leader does not choose one in time.
 */
export const handleWordSelectionTimeout = async (
  context: GameEngineContext,
  roomId: RoomId,
  miniRoundNumber: number,
  callbacks: DrawingPhaseCallbacks,
): Promise<void> => {
  const state = await getRoomState(context.redis, roomId);
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
    context.wordService.pickFallbackWord(state.settings.wordDifficulty);
  await transitionToDrawing(context, state, autoSelectedWord, callbacks);
};

/**
 * Finishes a drawing phase when the round timer expires.
 */
export const handleDrawingTimeout = async (
  context: GameEngineContext,
  roomId: RoomId,
  miniRoundNumber: number,
  onRoundEndTimeout: (nextRoomId: RoomId, nextMiniRoundNumber: number) => void,
): Promise<void> => {
  const state = await getRoomState(context.redis, roomId);
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

  context.roomTimers.clearHintTimers(roomId);
  const roundEndState = await finalizeRoundEnd({
    context,
    state,
    reason: 'time_over',
  });

  context.roomTimers.scheduleRoundEndTimeout(roundEndState.roomId, () => {
    onRoundEndTimeout(roundEndState.roomId, roundEndState.miniRoundNumber);
  });
};

/**
 * Starts the next mini-round or finishes the game after round end.
 */
export const handleRoundEndTimeout = async (
  context: GameEngineContext,
  roomId: RoomId,
  miniRoundNumber: number,
  onWordSelectionTimeout: (nextRoomId: RoomId, nextMiniRoundNumber: number) => void,
): Promise<void> => {
  const state = await getRoomState(context.redis, roomId);
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
    const gameOverState = createGameOverState(state);

    await saveRoomState(context.redis, gameOverState);
    emitToRoom(
      context.roomEmitterTarget,
      gameOverState.roomId,
      'game_over',
      createGameOverEvent(gameOverState, getWinners(gameOverState)),
    );
    context.roomTimers.clearRoomTimers(gameOverState.roomId);
    return;
  }

  const nextState = createNextWordSelectionState(context, state);

  await saveRoomState(context.redis, nextState);
  await emitRoundStart(context, nextState);
  context.roomTimers.scheduleWordSelectionTimeout(nextState.roomId, () => {
    onWordSelectionTimeout(nextState.roomId, nextState.miniRoundNumber);
  });
};

const transitionToDrawing = async (
  context: GameEngineContext,
  state: RoomState,
  chosenWord: Word,
  callbacks: DrawingPhaseCallbacks,
): Promise<void> => {
  context.roomTimers.cancelWordSelectionTimeout(state.roomId);
  const drawingState = createDrawingState(state, chosenWord);

  await saveRoomState(context.redis, drawingState);
  await emitRoundStart(context, drawingState);
  context.roomTimers.scheduleHintTimers(
    drawingState.roomId,
    drawingState.settings.roundTimeSec,
    drawingState.hintsTotal,
    () => {
      callbacks.onHintTimeout(drawingState.roomId, drawingState.miniRoundNumber);
    },
  );
  context.roomTimers.scheduleDrawingTimeout(
    drawingState.roomId,
    drawingState.settings.roundTimeSec,
    () => {
      callbacks.onDrawingTimeout(drawingState.roomId, drawingState.miniRoundNumber);
    },
  );
};
