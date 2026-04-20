import type { RedisClientType } from 'redis';

import {
  type CreateRoomResponse,
  type RoomInfoResponse,
  createRoomRequestSchema,
  roomIdSchema,
} from '@skribbl/shared';

import { getRoomState } from '../../../repositories/room-repository.js';
import { RoomManager } from '../../../services/game/room-manager.js';
import { createRoomWithOwner } from '../../../services/game/room-service.js';
import type { RouteHandler } from '../router.js';
import { sendError, sendJson } from '../router.js';

export const createPostRoomHandler = (deps: {
  redis: RedisClientType;
  roomManager: RoomManager;
}): RouteHandler => {
  return async ({ res, body }) => {
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

export const createGetRoomHandler = (deps: { redis: RedisClientType }): RouteHandler => {
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
