import { randomUUID } from 'node:crypto';

import type { Player, ServerToClientEventPayloads } from '@skribbl/shared';

import { systemPlayerId } from '../../constants/socket.js';
import type { RoomState } from '../../repositories/room-repository.js';
import type { GuessResultErrorCode } from '../../types/socket.js';

const nowIso = (): string => new Date().toISOString();

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
  playerId: string,
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

export const createSessionReadyEvent = (params: {
  roomId: string;
  playerId: string;
  reconnectToken: string;
  state: RoomState;
}): ServerToClientEventPayloads['session_ready'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.roomId,
  playerId: params.playerId,
  reconnectToken: params.reconnectToken,
  state: params.state,
});

export const createPlayerLeftEvent = (params: {
  state: RoomState;
  playerId: string;
  reason: ServerToClientEventPayloads['player_left']['reason'];
}): ServerToClientEventPayloads['player_left'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.state.roomId,
  playerId: params.playerId,
  reason: params.reason,
  playersCount: params.state.players.length,
});

export const createJoinErrorEvent = (params: {
  roomId: string;
  code: GuessResultErrorCode;
  message: string;
}): ServerToClientEventPayloads['guess_result'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.roomId,
  playerId: systemPlayerId,
  messageId: randomUUID(),
  ok: false,
  error: {
    code: params.code,
    message: params.message,
  },
});

export const createRateLimitEvent = (params: {
  roomId: string;
  playerId: string;
}): ServerToClientEventPayloads['guess_result'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.roomId,
  playerId: params.playerId,
  messageId: randomUUID(),
  ok: false,
  error: {
    code: 'rate_limit_exceeded',
    message: 'Rate limit exceeded',
  },
});

export const createRoundStartEvent = (
  state: RoomState,
  options: { wordOptions?: string[] } = {},
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
  nextLeaderPlayerId: string,
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
  winners: string[],
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

export const createGuessResultEvent = (params: {
  roomId: string;
  playerId: string;
  messageId: string;
  result: 'correct' | 'incorrect' | 'near_miss' | 'blocked';
  awardedScore?: number;
  position?: number;
}): ServerToClientEventPayloads['guess_result'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.roomId,
  playerId: params.playerId,
  messageId: params.messageId,
  ok: true,
  result: params.result,
  awardedScore: params.awardedScore,
  position: params.position,
});

export const createWordRevealEvent = (params: {
  roomId: string;
  word: string;
  leaderPlayerId: string;
}): ServerToClientEventPayloads['word_reveal'] => ({
  eventId: randomUUID(),
  ts: nowIso(),
  roomId: params.roomId,
  word: params.word,
  leaderPlayerId: params.leaderPlayerId,
});
