import { saveRoomState } from '../../repositories/room-repository.js';
import { emitToRoom } from '../../transport/socket/emitter.js';
import {
  createRoundEndEvent,
  createScoreUpdateEvent,
  createWordRevealEvent,
} from '../../transport/socket/event-factories.js';
import type { RoomState } from '../../types/types-game.js';
import type { GameEngineContext } from './game-engine-context.js';
import { createRoundEndState } from './game-phase-state.js';

interface FinalizeRoundEndParams {
  context: GameEngineContext;
  state: RoomState;
  reason: 'time_over' | 'all_guessed';
}

/**
 * Persists and emits the shared round-end transition.
 */
export const finalizeRoundEnd = async ({
  context,
  state,
  reason,
}: FinalizeRoundEndParams): Promise<RoomState> => {
  const { nextLeaderPlayerId, roundEndState } = createRoundEndState(state);

  await saveRoomState(context.redis, roundEndState);

  emitToRoom(
    context.roomEmitterTarget,
    roundEndState.roomId,
    'score_update',
    createScoreUpdateEvent(roundEndState),
  );
  emitToRoom(
    context.roomEmitterTarget,
    roundEndState.roomId,
    'word_reveal',
    createWordRevealEvent({
      roomId: state.roomId,
      word: state.word,
      leaderPlayerId: state.leaderPlayerId,
    }),
  );
  emitToRoom(
    context.roomEmitterTarget,
    roundEndState.roomId,
    'round_end',
    createRoundEndEvent(roundEndState, reason, nextLeaderPlayerId),
  );

  return roundEndState;
};
