import { RoundPhase } from '@skribbl/shared';

import { emitToRoom, emitToSocket } from '../../../../transport/socket/emitter.js';
import { createRoundStartEvent } from '../../../../transport/socket/event-factories.js';
import type { GameSocket } from '../../../../types/types-socket.js';
import type { RoomState } from '../../../../types/types-game.js';
import type { GameEngineContext } from '../../engine/game-engine-context.js';

/**
 * Отправляет `round_start`, скрывая варианты слов от угадывающих на этапе выбора слова.
 */
export const emitRoundStart = async (
  context: GameEngineContext,
  state: RoomState,
): Promise<void> => {
  if (state.roundPhase !== RoundPhase.WordSelection || !context.namespace) {
    emitToRoom(
      context.roomEmitterTarget,
      state.roomId,
      'round_start',
      createRoundStartEvent(state),
    );
    return;
  }

  const sockets = await context.namespace.in(state.roomId).fetchSockets();
  const leaderPayload = createRoundStartEvent(state, { wordOptions: state.wordOptions });
  const guessingPayload = createRoundStartEvent(state, { wordOptions: [] });

  for (const roomSocket of sockets) {
    emitToSocket(
      roomSocket as unknown as GameSocket,
      'round_start',
      roomSocket.data.playerId === state.leaderPlayerId ? leaderPayload : guessingPayload,
    );
  }
};
