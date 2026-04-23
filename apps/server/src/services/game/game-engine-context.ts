import type { RedisClientType } from 'redis';

import type { RoomEmitterTarget, GameNamespace } from '../../types/types-socket.js';
import type { RoomTimerScheduler } from './room-timer-scheduler.js';
import type { WordService } from '../word-service/word-service.js';

/**
 * Runtime dependencies shared by game engine flows.
 */
export interface GameEngineContext {
  redis: RedisClientType;
  roomEmitterTarget: RoomEmitterTarget;
  roomTimers: RoomTimerScheduler;
  namespace?: GameNamespace;
  wordService: WordService;
}
