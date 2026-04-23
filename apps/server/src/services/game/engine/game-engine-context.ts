import type { RedisClientType } from 'redis';

import type { RoomEmitterTarget, GameNamespace } from '../../../types/types-socket.js';
import type { RoomTimerScheduler } from '../timers/room-timer-scheduler.js';
import type { WordService } from '../../word-service/word-service.js';

/**
 * Зависимости времени выполнения, общие для сценариев игрового движка.
 */
export interface GameEngineContext {
  redis: RedisClientType;
  roomEmitterTarget: RoomEmitterTarget;
  roomTimers: RoomTimerScheduler;
  namespace?: GameNamespace;
  wordService: WordService;
}
