import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GamePhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { RoomManager } from './room-manager.js';
import { createRoomWithOwner } from './room-service.js';

const makeRedisMock = () => {
  const storage: Record<string, string> = {};
  const hashStorage: Record<string, Record<string, string>> = {};
  const redis = {
    set: async (key: string, value: string) => {
      storage[key] = value;
      return 'OK' as const;
    },
    get: async (key: string) => storage[key] ?? null,
    hSet: async (key: string, fields: Record<string, string>) => {
      hashStorage[key] = { ...(hashStorage[key] ?? {}), ...fields };
      return 0;
    },
  } as unknown as RedisClientType;
  return { redis, storage, hashStorage };
};

describe('createRoomWithOwner', () => {
  it('создаёт комнату, владельца и сессию, сохраняет в Redis', async () => {
    const { redis, storage, hashStorage } = makeRedisMock();
    const roomManager = new RoomManager(
      async () => {},
      async () => {},
    );

    const { state, session } = await createRoomWithOwner(
      { nickname: 'Alice' },
      { redis, roomManager },
    );

    assert.match(state.roomId, /^[A-Z0-9]{6}$/);
    assert.equal(state.phase, GamePhase.Lobby);
    assert.equal(state.players.length, 1);
    assert.equal(state.players[0]!.nickname, 'Alice');
    assert.equal(state.players[0]!.isOwner, true);
    assert.equal(state.players[0]!.id, session.playerId);

    assert.ok(storage[`skribbl:room:${state.roomId}`]);
    assert.ok(hashStorage[`skribbl:session:${session.sessionId}`]);
    const saved = hashStorage[`skribbl:session:${session.sessionId}`]!;
    assert.equal(saved.roomId, state.roomId);
    assert.equal(saved.playerId, session.playerId);
    assert.equal(saved.nickname, 'Alice');
  });

  it('применяет settingsOverride', async () => {
    const { redis } = makeRedisMock();
    const roomManager = new RoomManager(
      async () => {},
      async () => {},
    );

    const { state } = await createRoomWithOwner(
      { nickname: 'Bob', settingsOverride: { maxPlayers: 4, roundsCount: 5 } },
      { redis, roomManager },
    );

    assert.equal(state.settings.maxPlayers, 4);
    assert.equal(state.settings.roundsCount, 5);
  });

  it('регистрирует комнату в RoomManager', async () => {
    const { redis } = makeRedisMock();
    const roomManager = new RoomManager(
      async () => {},
      async () => {},
    );

    const { state } = await createRoomWithOwner({ nickname: 'Alice' }, { redis, roomManager });

    assert.equal(roomManager.hasRoom(state.roomId), true);
  });
});
