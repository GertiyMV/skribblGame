import { randomUUID } from 'node:crypto';

import type {
  MessageId,
  PlayerId,
  RoomId,
  Score,
  ServerToClientEventPayloads,
} from '@skribbl/shared';

import { nowIso } from './event-factory-shared.js';

export const createGuessResultEvent = (params: {
  roomId: RoomId;
  playerId: PlayerId;
  messageId: MessageId;
  result: 'correct' | 'incorrect' | 'near_miss' | 'blocked';
  awardedScore?: Score;
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
