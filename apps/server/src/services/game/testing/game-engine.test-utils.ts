import { setTimeout } from 'node:timers';

import { GamePhase, RoundPhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import type { RoomState } from '../../../types/types-game.js';
import type {
  GameNamespace,
  GameSocket,
  RoomEmitterTarget,
  SocketData,
} from '../../../types/types-socket.js';

export const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

export const createInMemoryRedis = (initialState?: RoomState) => {
  const storage = new Map<string, string>();
  if (initialState) {
    storage.set(`skribbl:room:${initialState.roomId}`, JSON.stringify(initialState));
  }

  const redis = {
    get: async (key: string) => storage.get(key) ?? null,
    set: async (key: string, value: string) => {
      storage.set(key, value);
      return 'OK' as const;
    },
  } as unknown as RedisClientType;

  return { redis, storage };
};

export const makeRoomEmitter = () => {
  const events: { roomId: string; event: string; payload: unknown }[] = [];
  const roomEmitterTarget = {
    to: (roomId: string) => ({
      emit: (event: string, payload: unknown) => {
        events.push({ roomId, event, payload });
      },
    }),
  } as unknown as RoomEmitterTarget;

  return { roomEmitterTarget, events };
};

export const makeSocket = (data: SocketData) => {
  const events: { event: string; payload: unknown }[] = [];
  const socket = {
    data,
    emit: (event: string, payload: unknown) => {
      events.push({ event, payload });
    },
  } as unknown as GameSocket;

  return { socket, events };
};

export const makeNamespace = (sockets: GameSocket[]): GameNamespace =>
  ({
    in: (_roomId: string) => ({
      fetchSockets: async () => sockets,
    }),
  }) as unknown as GameNamespace;

export const makeFakeTimers = () => {
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

  const tickFirst = (): void => {
    if (pending.size === 0) {
      return;
    }

    const firstId = Math.min(...pending.keys());
    const fn = pending.get(firstId)!;
    pending.delete(firstId);
    fn();
  };

  return { fakeSetTimeout, fakeClearTimeout, tick, tickFirst };
};

export const baseState = (overrides: Partial<RoomState> = {}): RoomState => ({
  roomId: 'ROOM01',
  phase: GamePhase.Lobby,
  roundPhase: RoundPhase.RoundEnd,
  miniRoundNumber: 0,
  totalMiniRounds: 1,
  leaderPlayerId: 'owner-id',
  roundEndAt: '2026-04-08T12:00:00.000Z',
  wordOptions: [],
  usedWords: [],
  word: '',
  wordMask: '',
  wordLength: 0,
  hintsUsed: 0,
  hintsTotal: 0,
  players: [
    {
      id: 'owner-id',
      nickname: 'Owner',
      score: 10,
      isOwner: true,
      guessed: false,
      connectionStatus: 'connected',
      role: 'guessing',
    },
    {
      id: 'p2',
      nickname: 'P2',
      score: 3,
      isOwner: false,
      guessed: false,
      connectionStatus: 'connected',
      role: 'guessing',
    },
  ],
  settings: {
    maxPlayers: 8,
    roundTimeSec: 80,
    roundsCount: 1,
    wordChoicesCount: 3,
    hintsCount: 0,
    language: 'ru',
    wordDifficulty: 'medium',
    useCustomWordsOnly: false,
  },
  roundParticipantsCount: 2,
  ...overrides,
});
