import { randomUUID } from 'node:crypto';

import type { PlayerId, RoomId, ServerToClientEventPayloads } from '@skribbl/shared';

import { systemPlayerId } from '../../constants/socket.js';
import type { RoomState } from '../../types/types-game.js';
import type { GuessResultErrorCode } from '../../types/types-socket.js';
import { nowIso } from './event-factory-shared.js';

export const createSessionReadyEvent = (params: {
  roomId: RoomId;
  playerId: PlayerId;
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

export const createJoinErrorEvent = (params: {
  roomId: RoomId;
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
  roomId: RoomId;
  playerId: PlayerId;
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
