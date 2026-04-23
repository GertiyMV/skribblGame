import type { RedisClientType } from 'redis';

import type { HttpRateLimiter } from '../utils/http-rate-limiter.js';
import type { RoomManager } from '../services/game/room/room-manager.js';

export type HttpHandlerDeps = {
  redis: RedisClientType;
  roomManager: RoomManager;
  clientOrigin: string;
  rateLimiter?: HttpRateLimiter;
  trustProxy?: boolean;
};
