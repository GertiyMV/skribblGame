import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { GamePhase, RoundPhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { RoomManager } from '../../services/game/room-manager.js';
import type { RoomState } from '../../types/types-game.js';
import { createHttpHandler } from './create-http-handler.js';

type FakeRedisOverrides = {
  ping?: () => Promise<string>;
  get?: (key: string) => Promise<string | null>;
};

const makeFakeRedis = (overrides: FakeRedisOverrides = {}) => {
  const storage: Record<string, string> = {};
  const hashStorage: Record<string, Record<string, string>> = {};
  const redis = {
    ping: overrides.ping ?? (async () => 'PONG'),
    set: async (key: string, value: string) => {
      storage[key] = value;
      return 'OK' as const;
    },
    get: overrides.get ?? (async (key: string) => storage[key] ?? null),
    hSet: async (key: string, fields: Record<string, string>) => {
      hashStorage[key] = { ...(hashStorage[key] ?? {}), ...fields };
      return 0;
    },
  } as unknown as RedisClientType;
  return { redis, storage, hashStorage };
};

const startServer = (redis: RedisClientType, roomManager: RoomManager) => {
  const handler = createHttpHandler({
    redis,
    roomManager,
    clientOrigin: 'http://localhost:5173',
  });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
};

const closeServer = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const noopManager = () =>
  new RoomManager(
    async () => {},
    async () => {},
  );

describe('GET /health', () => {
  it('200 ok при успешном Redis PING', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/health`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type')?.startsWith('application/json'), true);
      assert.deepEqual(await response.json(), { status: 'ok' });
    } finally {
      await closeServer(server);
    }
  });

  it('503 degraded при падении Redis PING', async () => {
    const { redis } = makeFakeRedis({
      ping: async () => {
        throw new Error('redis down');
      },
    });
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/health`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: 'degraded', redis: 'down' });
    } finally {
      await closeServer(server);
    }
  });
});

describe('POST /rooms', () => {
  it('201 создаёт комнату и возвращает roomId/playerId/reconnectToken/state', async () => {
    const { redis, storage } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Alice' }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as {
        roomId: string;
        playerId: string;
        reconnectToken: string;
        state: { phase: string; players: { nickname: string }[] };
      };
      assert.match(body.roomId, /^[A-Z0-9]{6}$/);
      assert.ok(body.playerId);
      assert.ok(body.reconnectToken);
      assert.equal(body.state.phase, GamePhase.Lobby);
      assert.equal(body.state.players[0]!.nickname, 'Alice');
      assert.ok(storage[`skribbl:room:${body.roomId}`]);
    } finally {
      await closeServer(server);
    }
  });

  it('400 invalid_payload при невалидном nickname', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '' }),
      });
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'invalid_payload');
    } finally {
      await closeServer(server);
    }
  });

  it('400 invalid_payload при битом JSON', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      });
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'invalid_payload');
    } finally {
      await closeServer(server);
    }
  });
});

describe('GET /rooms/:code', () => {
  const existingState: RoomState = {
    roomId: 'ABCDEF',
    phase: GamePhase.Lobby,
    roundPhase: RoundPhase.RoundEnd,
    miniRoundNumber: 0,
    totalMiniRounds: 2,
    leaderPlayerId: 'owner',
    roundEndAt: '2026-04-08T12:00:00.000Z',
    wordOptions: [],
    usedWords: [],
    word: '',
    wordMask: '',
    wordLength: 0,
    hintsUsed: 0,
    hintsTotal: 3,
    players: [
      {
        id: 'owner',
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

  it('200 exists:true с полями phase/playersCount/maxPlayers', async () => {
    const { redis } = makeFakeRedis({
      get: async (key: string) =>
        key === 'skribbl:room:ABCDEF' ? JSON.stringify(existingState) : null,
    });
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms/ABCDEF`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        exists: true,
        phase: GamePhase.Lobby,
        playersCount: 1,
        maxPlayers: 8,
      });
    } finally {
      await closeServer(server);
    }
  });

  it('404 exists:false при отсутствующей комнате', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms/ZZZZZZ`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { exists: false });
    } finally {
      await closeServer(server);
    }
  });

  it('400 invalid_room_code при невалидном формате', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms/ab`);
      assert.equal(response.status, 400);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'invalid_room_code');
    } finally {
      await closeServer(server);
    }
  });
});

describe('CORS и маршрутизация', () => {
  it('OPTIONS preflight возвращает 204 с CORS-заголовками', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/rooms`, { method: 'OPTIONS' });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
      assert.ok(response.headers.get('access-control-allow-methods')?.includes('POST'));
    } finally {
      await closeServer(server);
    }
  });

  it('404 на неизвестном маршруте', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/unknown`);
      assert.equal(response.status, 404);
    } finally {
      await closeServer(server);
    }
  });

  it('CORS-заголовок присутствует на обычных ответах', async () => {
    const { redis } = makeFakeRedis();
    const { server, url } = await startServer(redis, noopManager());
    try {
      const response = await fetch(`${url}/health`);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    } finally {
      await closeServer(server);
    }
  });
});
