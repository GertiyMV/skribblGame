import { randomUUID } from 'node:crypto';

import type { PlayerId, ServerToClientEventPayloads, Word } from '@skribbl/shared';

import type { RoomState } from '../../types/types-game.js';
import { nowIso } from './event-factory-shared.js';

export const createRoundStartEvent = (
  state: RoomState,
  options: { wordOptions?: Word[] } = {},
): ServerToClientEventPayloads['round_start'] => {
  const baseEvent = {
    eventId: randomUUID(),
    ts: nowIso(),
    roomId: state.roomId,
    miniRoundNumber: state.miniRoundNumber,
    totalMiniRounds: state.totalMiniRounds,
    leaderPlayerId: state.leaderPlayerId,
    roundEndAt: state.roundEndAt,
  };

  if (state.roundPhase === 'word_selection') {
    return {
      ...baseEvent,
      phase: 'word_selection',
      wordOptions: options.wordOptions ?? state.wordOptions,
      wordMask: '',
      wordLength: 0,
    };
  }

  return {
    ...baseEvent,
    phase: 'drawing',
    wordOptions: [],
    wordMask: state.wordMask,
    wordLength: state.wordLength,
  };
};

export const createRoundEndEvent = (
  state: RoomState,
  reason: ServerToClientEventPayloads['round_end']['reason'],
  nextLeaderPlayerId: PlayerId,
): ServerToClientEventPayloads['round_end'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: state.roomId,
  miniRoundNumber: state.miniRoundNumber,
  reason,
  nextLeaderPlayerId,
});

export const createHintUpdateEvent = (
  state: RoomState,
): ServerToClientEventPayloads['hint_update'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: state.roomId,
  mask: state.wordMask,
  hintsUsed: state.hintsUsed,
  hintsTotal: state.hintsTotal,
});

export const createGameOverEvent = (
  state: RoomState,
  winners: PlayerId[],
): ServerToClientEventPayloads['game_over'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: state.roomId,
  winners,
  finalScores: state.players.map((player) => ({
    playerId: player.id,
    score: player.score,
  })),
});

export const createWordRevealEvent = (params: {
  roomId: string;
  word: Word;
  leaderPlayerId: PlayerId;
}): ServerToClientEventPayloads['word_reveal'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.roomId,
  word: params.word,
  leaderPlayerId: params.leaderPlayerId,
});
