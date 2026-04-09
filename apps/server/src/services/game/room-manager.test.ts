import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

describe('createRoom', () => {
  it('возвращает 6-символьный код из заглавных букв и цифр', () => {
    const manager = new RoomManager(noop, noop);
    const code = manager.createRoom();
    assert.match(code, /^[A-Z0-9]{6}$/);
  });

  it('генерирует уникальные коды при множественных вызовах', () => {
    const manager = new RoomManager(noop, noop);
    const codes = new Set(Array.from({ length: 100 }, () => manager.createRoom()));
    assert.equal(codes.size, 100);
  });
});

describe('hasRoom', () => {
  it('возвращает true для созданной комнаты', () => {
    const manager = new RoomManager(noop, noop);
    const roomId = manager.createRoom();
    assert.equal(manager.hasRoom(roomId), true);
  });

  it('возвращает false для несуществующей комнаты', () => {
    const manager = new RoomManager(noop, noop);
    assert.equal(manager.hasRoom('ZZZZZZ'), false);
  });
});

describe('addPlayer', () => {
  it('ничего не делает для неизвестной комнаты', () => {
    const manager = new RoomManager(noop, noop);
    assert.doesNotThrow(() => manager.addPlayer('ZZZZZZ', 'player-1'));
  });

  it('отменяет таймер переподключения при возврате игрока', () => {
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

  it('отменяет таймер удаления пустой комнаты', () => {
    const { fakeSetTimeout, fakeClearTimeout } = makeFakeTimers();
    const manager = new RoomManager(noop, noop, {
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    });
    const roomId = manager.createRoom();
    manager.addPlayer(roomId, 'player-1');
    manager.removePlayer(roomId, 'player-1');
    manager.addPlayer(roomId, 'player-2');
    assert.equal(manager.hasRoom(roomId), true);
  });
});

describe('removePlayer', () => {
  it('ничего не делает для неизвестной комнаты', () => {
    const manager = new RoomManager(noop, noop);
    assert.doesNotThrow(() => manager.removePlayer('ZZZZZZ', 'player-1'));
  });

  it('сохраняет комнату сразу после выхода последнего игрока в окне переподключения', () => {
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

  it('оставляет игрока в комнате, пока окно переподключения активно', () => {
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

  it('вызывает onReconnectTimeout после истечения окна переподключения', async () => {
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
});

describe('deleteRoom', () => {
  it('удаляет комнату сразу', () => {
    const manager = new RoomManager(noop, noop);
    const roomId = manager.createRoom();
    manager.deleteRoom(roomId);
    assert.equal(manager.hasRoom(roomId), false);
  });

  it('ничего не делает для неизвестной комнаты', () => {
    const manager = new RoomManager(noop, noop);
    assert.doesNotThrow(() => manager.deleteRoom('ZZZZZZ'));
  });

  it('отменяет таймеры переподключения для игроков в комнате', () => {
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
});
