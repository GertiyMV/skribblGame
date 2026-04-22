import { randomUUID } from 'node:crypto';

import type { Player, PlayerId, ServerToClientEventPayloads } from '@skribbl/shared';

import type { RoomState } from '../../types/types-game.js';
import { nowIso } from './event-factory-shared.js';

const toJoinedPlayer = (
  player: Player,
): ServerToClientEventPayloads['player_joined']['player'] => ({
  playerId: player.id,
  nickname: player.nickname,
  score: player.score,
  isOwner: player.isOwner,
  guessed: player.guessed,
});

export const createPlayerJoinedEvent = (
  state: RoomState,
  playerId: PlayerId,
): ServerToClientEventPayloads['player_joined'] => {
  const player = state.players.find((entry) => entry.id === playerId);

  if (!player) {
    throw new Error('Player not found in room state');
  }

  return {
    eventId: randomUUID(),
    ts: nowIso(),
    roomId: state.roomId,
    player: toJoinedPlayer(player),
    playersCount: state.players.length,
  };
};

export const createScoreUpdateEvent = (
  state: RoomState,
): ServerToClientEventPayloads['score_update'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: state.roomId,
  scores: state.players.map((player) => ({
    playerId: player.id,
    score: player.score,
  })),
});

export const createPlayerLeftEvent = (params: {
  state: RoomState;
  playerId: PlayerId;
  reason: ServerToClientEventPayloads['player_left']['reason'];
}): ServerToClientEventPayloads['player_left'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.state.roomId,
  playerId: params.playerId,
  reason: params.reason,
  playersCount: params.state.players.length,
});
