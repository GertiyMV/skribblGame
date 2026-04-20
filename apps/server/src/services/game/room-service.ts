import { randomUUID } from 'node:crypto';

import type { ClientToServerEventPayloads, Nickname } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { createInitialRoomState, saveRoomState } from '../../repositories/room-repository.js';
import { saveSession } from '../../repositories/session-repository.js';
import type { RoomState } from '../../types/types-game.js';
import type { PlayerSession } from '../../types/types-session.js';
import { RoomManager } from './room-manager.js';

export type CreateRoomWithOwnerInput = {
  nickname: Nickname;
  settingsOverride?: ClientToServerEventPayloads['create_room']['settingsOverride'];
};

export type CreateRoomWithOwnerResult = {
  state: RoomState;
  session: PlayerSession;
};

export const createRoomWithOwner = async (
  input: CreateRoomWithOwnerInput,
  deps: { redis: RedisClientType; roomManager: RoomManager },
): Promise<CreateRoomWithOwnerResult> => {
  const roomId = deps.roomManager.createRoom();
  const playerId = randomUUID();
  const sessionId = randomUUID();

  const state = createInitialRoomState({
    roomId,
    ownerPlayerId: playerId,
    ownerNickname: input.nickname,
    settingsOverride: input.settingsOverride,
  });

  const session: PlayerSession = {
    sessionId,
    roomId,
    playerId,
    nickname: input.nickname,
  };

  await saveRoomState(deps.redis, state);
  await saveSession(deps.redis, session);

  return { state, session };
};
