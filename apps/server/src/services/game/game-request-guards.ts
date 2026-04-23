import type { RedisClientType } from 'redis';

import type { RoomId } from '@skribbl/shared';

import { getRoomState } from '../../repositories/room-repository.js';
import { emitToSocket } from '../../transport/socket/emitter.js';
import { createJoinErrorEvent } from '../../transport/socket/event-factories.js';
import type { RoomState } from '../../types/types-game.js';
import type { GameSocket } from '../../types/types-socket.js';

/**
 * Проверяет, действует ли сокет в контексте текущей комнаты.
 */
export const hasValidRoomContext = (socket: GameSocket, roomId: RoomId): boolean => {
  const { playerId, roomId: socketRoomId } = socket.data;
  return Boolean(playerId && socketRoomId === roomId);
};

/**
 * Отправляет стандартную ошибку контекста комнаты в канал `guess_result`.
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
 * Загружает состояние комнаты или отправляет стандартную ошибку отсутствия комнаты.
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
