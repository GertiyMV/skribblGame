import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers';

import { RoomManager } from './room-manager.js';

const noop = async (): Promise<void> => {};

// Fake timer that fires all pending callbacks on demand
const makeFakeTimers = () => {
  const pending = new Map<number, () => void>();
  let nextId = 1;

  const fakeSetTimeout = (fn: () => void, _ms: number): ReturnType<typeof setTimeout> => {
    const id = nextId++;
    pending.set(id, fn);
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  const fakeClearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    pending.delete(handle as unknown as number);
  };

  const tick = (): void => {
    for (const [id, fn] of [...pending]) {
      pending.delete(id);
      fn();
    }
  };

  return { fakeSetTimeout, fakeClearTimeout, tick };
};

test('createRoom: returns a 6-character uppercase alphanumeric code', () => {
  const manager = new RoomManager(noop, noop);
  const code = manager.createRoom();
  assert.match(code, /^[A-Z0-9]{6}$/);
});

test('createRoom: generated codes are unique across multiple calls', () => {
  const manager = new RoomManager(noop, noop);
  const codes = new Set(Array.from({ length: 100 }, () => manager.createRoom()));
  assert.equal(codes.size, 100);
});

test('hasRoom: returns true for created room', () => {
  const manager = new RoomManager(noop, noop);
  const roomId = manager.createRoom();
  assert.equal(manager.hasRoom(roomId), true);
});

test('hasRoom: returns false for non-existent room', () => {
  const manager = new RoomManager(noop, noop);
  assert.equal(manager.hasRoom('ZZZZZZ'), false);
});

test('addPlayer: does nothing for unknown room', () => {
  const manager = new RoomManager(noop, noop);
  assert.doesNotThrow(() => manager.addPlayer('ZZZZZZ', 'player-1'));
});

test('removePlayer: does nothing for unknown room', () => {
  const manager = new RoomManager(noop, noop);
  assert.doesNotThrow(() => manager.removePlayer('ZZZZZZ', 'player-1'));
});

test('removePlayer: room persists immediately after last player leaves (reconnect window active)', () => {
  const { fakeSetTimeout, fakeClearTimeout } = makeFakeTimers();
  const manager = new RoomManager(noop, noop, {
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  });
  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');
  assert.equal(manager.hasRoom(roomId), true);
});

test('removePlayer: player stays in room during reconnect window', () => {
  const { fakeSetTimeout, fakeClearTimeout } = makeFakeTimers();
  const manager = new RoomManager(noop, noop, {
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  });
  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');

  // Таймер не тикал — комната ещё существует
  assert.equal(manager.hasRoom(roomId), true);
});

test('addPlayer: cancels reconnect timer when player returns', () => {
  const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers();

  let timeoutCalled = false;
  const manager = new RoomManager(
    noop,
    async () => {
      timeoutCalled = true;
    },
    {
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    },
  );

  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');
  manager.addPlayer(roomId, 'player-1'); // отменяет таймер

  tick();
  assert.equal(timeoutCalled, false);
});

test('removePlayer: calls onReconnectTimeout after reconnect window expires', async () => {
  const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers();

  let capturedRoomId: string | null = null;
  let capturedPlayerId: string | null = null;

  const manager = new RoomManager(
    noop,
    async (roomId, playerId) => {
      capturedRoomId = roomId;
      capturedPlayerId = playerId;
    },
    {
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    },
  );

  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');

  tick();
  await Promise.resolve(); // ждём выполнения async-колбэка

  assert.equal(capturedRoomId, roomId);
  assert.equal(capturedPlayerId, 'player-1');
});

test('addPlayer: cancels empty room deletion timer', () => {
  const manager = new RoomManager(noop, noop);
  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');
  manager.addPlayer(roomId, 'player-2');
  assert.equal(manager.hasRoom(roomId), true);
});

test('deleteRoom: removes room immediately', () => {
  const manager = new RoomManager(noop, noop);
  const roomId = manager.createRoom();
  manager.deleteRoom(roomId);
  assert.equal(manager.hasRoom(roomId), false);
});

test('deleteRoom: does nothing for unknown room', () => {
  const manager = new RoomManager(noop, noop);
  assert.doesNotThrow(() => manager.deleteRoom('ZZZZZZ'));
});

test('deleteRoom: cancels reconnect timers for players in room', () => {
  const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers();

  let timeoutCalled = false;
  const manager = new RoomManager(
    noop,
    async () => {
      timeoutCalled = true;
    },
    {
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    },
  );

  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');
  manager.deleteRoom(roomId);

  tick();
  assert.equal(timeoutCalled, false);
});
