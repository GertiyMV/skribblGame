import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GamePhase, RoundPhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { RoomManager } from '../../../services/game/room-manager.js';
import type { RoomState } from '../../../types/types-game.js';
import type {
  GameNamespace,
  GameSocket,
  RoomEmitterTarget,
  SocketData,
} from '../../../types/types-socket.js';
import { handleJoinRoom } from './room-handlers.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE_ROOM_STATE: RoomState = {
  roomId: 'ABCDEF',
  phase: GamePhase.Lobby,
  roundPhase: RoundPhase.RoundEnd,
  miniRoundNumber: 0,
  totalMiniRounds: 2,
  leaderPlayerId: 'owner-id',
  roundEndAt: '2026-04-08T12:00:00.000Z',
  wordOptions: [],
  word: '',
  wordMask: '',
  wordLength: 0,
  hintsUsed: 0,
  hintsTotal: 3,
  players: [
    {
      id: 'owner-id',
      nickname: 'Owner',
      score: 0,
      isOwner: true,
      guessed: false,
      connectionStatus: 'connected',
      role: 'guessing',
    },
  ],
  settings: {
    maxPlayers: 8,
    roundTimeSec: 80,
    roundsCount: 2,
    wordChoicesCount: 3,
    hintsCount: 3,
    language: 'ru',
    wordDifficulty: 'medium',
    useCustomWordsOnly: false,
  },
  roundParticipantsCount: 1,
};

const makeRedisMock = (roomState: RoomState | null) =>
  ({
    get: async (_key: string) => (roomState ? JSON.stringify(roomState) : null),
    set: async (_key: string, _value: string) => 'OK' as const,
    hSet: async (_key: string, _fields: Record<string, string>) => 0,
    expire: async (_key: string, _seconds: number) => 0,
    multi: () => {
      const chain = {
        hSet: (_key: string, _fields: Record<string, string>) => chain,
        expire: (_key: string, _seconds: number) => chain,
        del: (_key: string) => chain,
        exec: async () => [] as unknown[],
      };
      return chain;
    },
  }) as unknown as RedisClientType;

const makeSocketMock = () => {
  const events: { event: string; payload: unknown }[] = [];
  const joined: string[] = [];
  const socket = {
    data: {} as SocketData,
    id: 'test-socket-id',
    join: (roomId: string) => {
      joined.push(roomId);
    },
    emit: (event: string, payload: unknown) => {
      events.push({ event, payload });
    },
    disconnect: (_force?: boolean) => {},
  } as unknown as GameSocket;
  return { socket, events, joined };
};

const makeIoMock = () =>
  ({
    in: (_roomId: string) => ({ fetchSockets: async () => [] }),
  }) as unknown as GameNamespace;

const makeRoomEmitterMock = () => {
  const broadcast: { roomId: string; event: string; payload: unknown }[] = [];
  const target = {
    to: (roomId: string) => ({
      emit: (event: string, payload: unknown) => {
        broadcast.push({ roomId, event, payload });
      },
    }),
  } as unknown as RoomEmitterTarget;
  return { target, broadcast };
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('handleJoinRoom', () => {
  it('эмитит room_not_found, если комнаты нет в Redis', async () => {
    const { socket, events } = makeSocketMock();

    await handleJoinRoom({
      io: makeIoMock(),
      roomEmitterTarget: makeRoomEmitterMock().target,
      socket,
      redis: makeRedisMock(null),
      roomManager: new RoomManager(
        async () => {},
        async () => {},
      ),
      payload: { roomId: 'ZZZZZZ', nickname: 'Alice' },
    });

    assert.equal(events.length, 1);
    const [emitted] = events;
    assert.equal(emitted!.event, 'guess_result');
    assert.equal((emitted!.payload as { error: { code: string } }).error.code, 'room_not_found');
  });

  it('эмитит game_in_progress, если фаза комнаты не Lobby', async () => {
    const state: RoomState = { ...BASE_ROOM_STATE, phase: GamePhase.InGame };
    const { socket, events } = makeSocketMock();

    await handleJoinRoom({
      io: makeIoMock(),
      roomEmitterTarget: makeRoomEmitterMock().target,
      socket,
      redis: makeRedisMock(state),
      roomManager: new RoomManager(
        async () => {},
        async () => {},
      ),
      payload: { roomId: 'ABCDEF', nickname: 'Alice' },
    });

    assert.equal(events.length, 1);
    const [emitted] = events;
    assert.equal(emitted!.event, 'guess_result');
    assert.equal((emitted!.payload as { error: { code: string } }).error.code, 'game_in_progress');
  });

  it('эмитит room_full, когда количество игроков достигает maxPlayers', async () => {
    const state: RoomState = {
      ...BASE_ROOM_STATE,
      settings: { ...BASE_ROOM_STATE.settings, maxPlayers: 2 },
      players: [
        {
          id: 'p1',
          nickname: 'Player1',
          score: 0,
          isOwner: true,
          guessed: false,
          connectionStatus: 'connected',
          role: 'guessing',
        },
        {
          id: 'p2',
          nickname: 'Player2',
          score: 0,
          isOwner: false,
          guessed: false,
          connectionStatus: 'connected',
          role: 'guessing',
        },
      ],
    };
    const { socket, events } = makeSocketMock();

    await handleJoinRoom({
      io: makeIoMock(),
      roomEmitterTarget: makeRoomEmitterMock().target,
      socket,
      redis: makeRedisMock(state),
      roomManager: new RoomManager(
        async () => {},
        async () => {},
      ),
      payload: { roomId: 'ABCDEF', nickname: 'Alice' },
    });

    assert.equal(events.length, 1);
    const [emitted] = events;
    assert.equal(emitted!.event, 'guess_result');
    assert.equal((emitted!.payload as { error: { code: string } }).error.code, 'room_full');
  });

  it('эмитит nickname_taken, если ник уже занят в комнате', async () => {
    const { socket, events } = makeSocketMock();

    await handleJoinRoom({
      io: makeIoMock(),
      roomEmitterTarget: makeRoomEmitterMock().target,
      socket,
      redis: makeRedisMock(BASE_ROOM_STATE),
      roomManager: new RoomManager(
        async () => {},
        async () => {},
      ),
      payload: { roomId: 'ABCDEF', nickname: 'Owner' },
    });

    assert.equal(events.length, 1);
    const [emitted] = events;
    assert.equal(emitted!.event, 'guess_result');
    assert.equal((emitted!.payload as { error: { code: string } }).error.code, 'nickname_taken');
  });

  it('при успешном входе эмитит session_ready в сокет и player_joined + score_update в комнату', async () => {
    const { socket, events, joined } = makeSocketMock();
    const { target, broadcast } = makeRoomEmitterMock();
    const roomManager = new RoomManager(
      async () => {},
      async () => {},
    );
    const roomId = roomManager.createRoom();
    const state: RoomState = { ...BASE_ROOM_STATE, roomId };

    await handleJoinRoom({
      io: makeIoMock(),
      roomEmitterTarget: target,
      socket,
      redis: makeRedisMock(state),
      roomManager,
      payload: { roomId, nickname: 'Alice' },
    });

    assert.equal(events.length, 1, 'socket receives session_ready');
    assert.equal(events[0]!.event, 'session_ready');

    const roomEvents = broadcast.filter((b) => b.roomId === roomId);
    const eventNames = roomEvents.map((b) => b.event);
    assert.ok(eventNames.includes('player_joined'), 'room receives player_joined');
    assert.ok(eventNames.includes('score_update'), 'room receives score_update');

    assert.deepEqual(joined, [roomId], 'socket joined the room');
    assert.equal(socket.data.roomId, roomId, 'socket.data.roomId is set');
    assert.ok(socket.data.playerId, 'socket.data.playerId is set');
  });
});
