import type { RedisClientType } from 'redis';

import { handleCreateRoom, handleDisconnect, handleJoinRoom } from './handlers/room-handlers.js';
import { parsePayload } from '../../utils/socket/parse-payload.js';
import type { GameNamespace, RoomEmitterTarget } from '../../types/socket.js';

export const registerGameHandlers = (params: {
  io: GameNamespace;
  roomEmitterTarget: RoomEmitterTarget;
  redis: RedisClientType;
}): void => {
  const { io, roomEmitterTarget, redis } = params;

  io.on('connection', (socket) => {
    socket.on('create_room', async (rawPayload) => {
      const payload = parsePayload('create_room', rawPayload);
      if (!payload) {
        return;
      }

      await handleCreateRoom({ socket, redis, payload });
    });

    socket.on('join_room', async (rawPayload) => {
      const payload = parsePayload('join_room', rawPayload);
      if (!payload) {
        return;
      }

      await handleJoinRoom({ roomEmitterTarget, socket, redis, payload });
    });

    socket.on('disconnect', async () => {
      await handleDisconnect(roomEmitterTarget, socket, redis);
    });
  });
};
