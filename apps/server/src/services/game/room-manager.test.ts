import assert from 'node:assert/strict';
import test from 'node:test';

import { RoomManager } from './room-manager.js';

test('createRoom: returns a 6-character uppercase alphanumeric code', () => {
  const manager = new RoomManager(async () => {});
  const code = manager.createRoom();
  assert.match(code, /^[A-Z0-9]{6}$/);
});

test('createRoom: generated codes are unique across multiple calls', () => {
  const manager = new RoomManager(async () => {});
  const codes = new Set(Array.from({ length: 100 }, () => manager.createRoom()));
  assert.equal(codes.size, 100);
});

test('hasRoom: returns true for created room', () => {
  const manager = new RoomManager(async () => {});
  const roomId = manager.createRoom();
  assert.equal(manager.hasRoom(roomId), true);
});

test('hasRoom: returns false for non-existent room', () => {
  const manager = new RoomManager(async () => {});
  assert.equal(manager.hasRoom('ZZZZZZ'), false);
});

test('addPlayer: does nothing for unknown room', () => {
  const manager = new RoomManager(async () => {});
  assert.doesNotThrow(() => manager.addPlayer('ZZZZZZ', 'player-1'));
});

test('removePlayer: does nothing for unknown room', () => {
  const manager = new RoomManager(async () => {});
  assert.doesNotThrow(() => manager.removePlayer('ZZZZZZ', 'player-1'));
});

test('removePlayer: room persists immediately after last player leaves (timer not yet fired)', () => {
  const manager = new RoomManager(async () => {});
  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');
  assert.equal(manager.hasRoom(roomId), true);
});

test('addPlayer: cancels empty room deletion timer', () => {
  const manager = new RoomManager(async () => {});
  const roomId = manager.createRoom();
  manager.addPlayer(roomId, 'player-1');
  manager.removePlayer(roomId, 'player-1');
  manager.addPlayer(roomId, 'player-2');
  assert.equal(manager.hasRoom(roomId), true);
});

test('deleteRoom: removes room immediately', () => {
  const manager = new RoomManager(async () => {});
  const roomId = manager.createRoom();
  manager.deleteRoom(roomId);
  assert.equal(manager.hasRoom(roomId), false);
});

test('deleteRoom: does nothing for unknown room', () => {
  const manager = new RoomManager(async () => {});
  assert.doesNotThrow(() => manager.deleteRoom('ZZZZZZ'));
});
