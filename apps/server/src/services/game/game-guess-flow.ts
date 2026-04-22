import {
  GamePhase,
  RoundPhase,
  type ClientToServerEventPayloads,
  type RoomId,
} from '@skribbl/shared';

import { getRoomState, saveRoomState } from '../../repositories/room-repository.js';
import { emitToRoom, emitToSocket } from '../../transport/socket/emitter.js';
import {
  createGuessResultEvent,
  createHintUpdateEvent,
  createJoinErrorEvent,
  createScoreUpdateEvent,
} from '../../transport/socket/event-factories.js';
import type { GameSocket } from '../../types/types-socket.js';
import type { GameEngineContext } from './game-engine-context.js';
import { applyCorrectGuess, areAllGuessersFinished } from './game-guess-state.js';
import { getCurrentPlayer } from './game-state-helpers.js';
import {
  emitInvalidRoomContextError,
  getRoomStateOrEmitError,
  hasValidRoomContext,
} from './game-request-guards.js';
import { finalizeRoundEnd } from './round-end-flow.js';
import { revealHint } from './word-mask.js';

/**
 * Reveals the next hint if the room is still in the active drawing phase.
 */
export const handleHintTimeout = async (
  context: GameEngineContext,
  roomId: RoomId,
  miniRoundNumber: number,
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

  const newMask = revealHint(state.word, state.wordMask);
  if (newMask === state.wordMask) {
    return;
  }

  const updatedState = {
    ...state,
    wordMask: newMask,
    hintsUsed: state.hintsUsed + 1,
  };

  await saveRoomState(context.redis, updatedState);
  emitToRoom(context.roomEmitterTarget, roomId, 'hint_update', createHintUpdateEvent(updatedState));
};

/**
 * Processes a player's guess and completes the round when everybody guessed.
 */
export const handleGuess = async (
  context: GameEngineContext,
  socket: GameSocket,
  payload: ClientToServerEventPayloads['guess'],
  onRoundEndTimeout: (nextRoomId: RoomId, nextMiniRoundNumber: number) => void,
): Promise<void> => {
  const playerId = socket.data.playerId;
  if (!playerId || !hasValidRoomContext(socket, payload.roomId)) {
    emitInvalidRoomContextError(socket, payload.roomId);
    return;
  }

  const state = await getRoomStateOrEmitError(context.redis, socket, payload.roomId);
  if (!state) {
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
      context.roomEmitterTarget,
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

  const { updatedState, awardedScore, position } = applyCorrectGuess(state, playerId);

  await saveRoomState(context.redis, updatedState);

  emitToRoom(
    context.roomEmitterTarget,
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
    context.roomEmitterTarget,
    state.roomId,
    'score_update',
    createScoreUpdateEvent(updatedState),
  );

  if (!areAllGuessersFinished(updatedState)) {
    return;
  }

  context.roomTimers.clearHintTimers(updatedState.roomId);
  context.roomTimers.cancelDrawingTimeout(updatedState.roomId);
  const roundEndState = await finalizeRoundEnd({
    context,
    state: updatedState,
    reason: 'all_guessed',
  });

  context.roomTimers.scheduleRoundEndTimeout(roundEndState.roomId, () => {
    onRoundEndTimeout(roundEndState.roomId, roundEndState.miniRoundNumber);
  });
};
