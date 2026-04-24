import type { RedisClientType } from 'redis';

import { handleCreateRoom, handleDisconnect, handleJoinRoom } from './handlers/room-handlers.js';
import { emitToSocket } from './emitter.js';
import { createRateLimitEvent } from './event-factories.js';
import { parsePayload } from '../../utils/socket/parse-payload.js';
import { GameEngine } from '../../services/game/engine/game-engine.js';
import { RoomManager } from '../../services/game/room/room-manager.js';
import { SocketRateLimiter } from '../../utils/rate-limiter.js';
import type { GameNamespace, RoomEmitterTarget } from '../../types/types-socket.js';
import type { Logger } from '../../logger.js';

export const registerGameHandlers = (params: {
  io: GameNamespace;
  roomEmitterTarget: RoomEmitterTarget;
  redis: RedisClientType;
  roomManager: RoomManager;
  gameEngine: GameEngine;
  logger: Logger;
}): void => {
  const { io, roomEmitterTarget, redis, roomManager, gameEngine, logger } = params;

  io.on('connection', (socket) => {
    const socketLogger = logger.child({ socketId: socket.id });
    socketLogger.info({}, 'socket connected');

    const rateLimiter = new SocketRateLimiter();

    socket.use((packet, next) => {
      const [event] = packet as [string, ...unknown[]];

      socketLogger.info({ event }, 'socket event');

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
      socketLogger.info({ reason }, 'socket disconnected');
      await handleDisconnect(roomEmitterTarget, socket, redis, roomManager, reason);
    });

    socket.on('start_game', async (rawPayload) => {
      const payload = parsePayload('start_game', rawPayload);
      if (!payload) {
        return;
      }

      await gameEngine.handleStartGame(socket, payload);
    });

    socket.on('choose_word', async (rawPayload) => {
      const payload = parsePayload('choose_word', rawPayload);
      if (!payload) {
        return;
      }

      await gameEngine.handleChooseWord(socket, payload);
    });

    socket.on('guess', async (rawPayload) => {
      const payload = parsePayload('guess', rawPayload);
      if (!payload) {
        return;
      }

      await gameEngine.handleGuess(socket, payload);
    });
  });
};
