import type { RedisClientType } from 'redis';

import { getRoomState } from '../../repositories/room-repository.js';

export const createUniqueRoomId = async (redis: RedisClientType): Promise<string> => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  while (true) {
    let code = '';

    for (let index = 0; index < 4; index += 1) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      code += chars[randomIndex] ?? chars[0];
    }

    const existingRoom = await getRoomState(redis, code);
    if (!existingRoom) {
      return code;
    }
  }
};
