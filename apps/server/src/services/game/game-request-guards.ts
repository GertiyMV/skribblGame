import type { RedisClientType } from 'redis';

import type { RoomId } from '@skribbl/shared';

import { getRoomState } from '../../repositories/room-repository.js';
import { emitToSocket } from '../../transport/socket/emitter.js';
import { createJoinErrorEvent } from '../../transport/socket/event-factories.js';
import type { RoomState } from '../../types/types-game.js';
import type { GameSocket } from '../../types/types-socket.js';

/**
 * Checks whether the socket is acting within its current room context.
 */
export const hasValidRoomContext = (socket: GameSocket, roomId: RoomId): boolean => {
  const { playerId, roomId: socketRoomId } = socket.data;
  return Boolean(playerId && socketRoomId === roomId);
};

/**
 * Emits a standard room-context error on the `guess_result` channel.
 */
export const emitInvalidRoomContextError = (socket: GameSocket, roomId: RoomId): void => {
  emitToSocket(
    socket,
    'guess_result',
    createJoinErrorEvent({
      roomId,
      code: 'forbidden_action',
      message: 'Invalid room context',
    }),
  );
};

/**
 * Loads room state or emits the canonical not-found error.
 */
export const getRoomStateOrEmitError = async (
  redis: RedisClientType,
  socket: GameSocket,
  roomId: RoomId,
): Promise<RoomState | null> => {
  const state = await getRoomState(redis, roomId);
  if (state) {
    return state;
  }

  emitToSocket(
    socket,
    'guess_result',
    createJoinErrorEvent({
      roomId,
      code: 'room_not_found',
      message: 'Room not found',
    }),
  );

  return null;
};
