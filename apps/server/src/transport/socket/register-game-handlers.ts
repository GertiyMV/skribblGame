import type { RedisClientType } from 'redis';

import { handleCreateRoom, handleDisconnect, handleJoinRoom } from './handlers/room-handlers.js';
import { emitToSocket } from './emitter.js';
import { createRateLimitEvent } from './event-factories.js';
import { parsePayload } from '../../utils/socket/parse-payload.js';
import { RoomManager } from '../../services/game/room-manager.js';
import { SocketRateLimiter } from '../../utils/rate-limiter.js';
import type { GameNamespace, RoomEmitterTarget } from '../../types/socket.js';

export const registerGameHandlers = (params: {
  io: GameNamespace;
  roomEmitterTarget: RoomEmitterTarget;
  redis: RedisClientType;
  roomManager: RoomManager;
}): void => {
  const { io, roomEmitterTarget, redis, roomManager } = params;

  io.on('connection', (socket) => {
    const rateLimiter = new SocketRateLimiter();

    socket.use((packet, next) => {
      const [event] = packet as [string, ...unknown[]];

      if (!rateLimiter.consume(event)) {
        const { roomId, playerId } = socket.data;

        if (roomId && playerId) {
          emitToSocket(socket, 'guess_result', createRateLimitEvent({ roomId, playerId }));
        }

        return;
      }

      next();
    });

    socket.on('create_room', async (rawPayload) => {
      const payload = parsePayload('create_room', rawPayload);
      if (!payload) {
        return;
      }

      await handleCreateRoom({ socket, redis, roomManager, payload });
    });

    socket.on('join_room', async (rawPayload) => {
      const payload = parsePayload('join_room', rawPayload);
      if (!payload) {
        return;
      }

      await handleJoinRoom({ io, roomEmitterTarget, socket, redis, roomManager, payload });
    });

    socket.on('disconnect', async (reason) => {
      await handleDisconnect(roomEmitterTarget, socket, redis, roomManager, reason);
    });
  });
};
