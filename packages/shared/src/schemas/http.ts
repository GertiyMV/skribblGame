import { z } from 'zod';

import { GamePhase } from '../types.js';
import {
  gameStateSchema,
  nicknameSchema,
  playerIdSchema,
  roomIdSchema,
  roomSettingsOverrideSchema,
} from './common.js';

export const httpErrorCodeSchema = z.enum([
  'invalid_payload',
  'invalid_room_code',
  'internal_error',
  'service_unavailable',
]);

export const httpErrorResponseSchema = z.object({
  error: z.object({
    code: httpErrorCodeSchema,
    message: z.string().trim().min(1),
  }),
});

export const healthOkResponseSchema = z.object({
  status: z.literal('ok'),
});

export const healthDegradedResponseSchema = z.object({
  status: z.literal('degraded'),
  redis: z.enum(['up', 'down']),
});

export const createRoomRequestSchema = z.object({
  nickname: nicknameSchema,
  settingsOverride: roomSettingsOverrideSchema.optional(),
});

export const createRoomResponseSchema = z.object({
  roomId: roomIdSchema,
  playerId: playerIdSchema,
  reconnectToken: z.string().trim().min(1),
  state: gameStateSchema,
});

export const roomInfoExistsSchema = z.object({
  exists: z.literal(true),
  phase: z.nativeEnum(GamePhase),
  playersCount: z.number().int().min(0),
  maxPlayers: z.number().int().min(1),
});

export const roomInfoMissingSchema = z.object({
  exists: z.literal(false),
});

export const roomInfoResponseSchema = z.discriminatedUnion('exists', [
  roomInfoExistsSchema,
  roomInfoMissingSchema,
]);

export type HttpErrorCode = z.infer<typeof httpErrorCodeSchema>;
export type HttpErrorResponse = z.infer<typeof httpErrorResponseSchema>;
export type HealthOkResponse = z.infer<typeof healthOkResponseSchema>;
export type HealthDegradedResponse = z.infer<typeof healthDegradedResponseSchema>;
export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
export type RoomInfoResponse = z.infer<typeof roomInfoResponseSchema>;
