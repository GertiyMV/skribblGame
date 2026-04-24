import {
  type CreateRoomResponse,
  type RoomInfoResponse,
  createRoomRequestSchema,
  roomIdSchema,
} from '@skribbl/shared';

import { getRoomState } from '../../../repositories/room-repository.js';
import { createRoomWithOwner } from '../../../services/game/room/room-service.js';
import type { HttpHandlerDeps } from '../../../types/types-http.js';
import { extractIp } from '../../../utils/http-rate-limiter.js';
import type { RouteHandler } from '../router.js';
import { sendError, sendJson } from '../router.js';

export const createPostRoomHandler = (
  deps: Omit<HttpHandlerDeps, 'clientOrigin' | 'logger'>,
): RouteHandler => {
  return async ({ req, res, body }) => {
    if (deps.rateLimiter) {
      const ip = extractIp(req, deps.trustProxy ?? false);
      if (!deps.rateLimiter.consume(ip)) {
        res.setHeader('Retry-After', String(deps.rateLimiter.retryAfterSeconds));
        sendError(res, 429, 'rate_limit_exceeded', 'Too many requests');
        return;
      }
    }

    const parseResult = createRoomRequestSchema.safeParse(body);
    if (!parseResult.success) {
      sendError(
        res,
        400,
        'invalid_payload',
        parseResult.error.issues[0]?.message ?? 'Invalid payload',
      );
      return;
    }

    const { state, session } = await createRoomWithOwner(
      {
        nickname: parseResult.data.nickname,
        settingsOverride: parseResult.data.settingsOverride,
      },
      { redis: deps.redis, roomManager: deps.roomManager },
    );

    const response: CreateRoomResponse = {
      roomId: state.roomId,
      playerId: session.playerId,
      reconnectToken: session.sessionId,
      state,
    };

    sendJson(res, 201, response);
  };
};

export const createGetRoomHandler = (deps: Pick<HttpHandlerDeps, 'redis'>): RouteHandler => {
  return async ({ res, params }) => {
    const code = params.code ?? '';
    const codeParse = roomIdSchema.safeParse(code);
    if (!codeParse.success) {
      sendError(res, 400, 'invalid_room_code', 'Invalid room code');
      return;
    }

    const state = await getRoomState(deps.redis, codeParse.data);
    if (!state) {
      const body: RoomInfoResponse = { exists: false };
      sendJson(res, 404, body);
      return;
    }

    const body: RoomInfoResponse = {
      exists: true,
      phase: state.phase,
      playersCount: state.players.length,
      maxPlayers: state.settings.maxPlayers,
    };
    sendJson(res, 200, body);
  };
};
