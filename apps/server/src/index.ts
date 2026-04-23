import http from 'node:http';

import { WS_MAX_PAYLOAD_BYTES } from '@skribbl/shared';
import { Server } from 'socket.io';

import { gameNamespace } from './constants/socket.js';
import { env } from './config/env.js';
import { deleteRoomState, getRoomState, saveRoomState } from './repositories/room-repository.js';
import type { RoomState } from './types/types-game.js';
import { RoomManager } from './services/game/room/room-manager.js';
import { GameEngine } from './services/game/engine/game-engine.js';
import { connectRedis } from './services/redis/client.js';
import { createHttpHandler } from './transport/http/create-http-handler.js';
import { HttpRateLimiter } from './utils/http-rate-limiter.js';
import { emitToRoom } from './transport/socket/emitter.js';
import { createScoreUpdateEvent } from './transport/socket/event-factories.js';
import { registerGameHandlers } from './transport/socket/register-game-handlers.js';
import type {
  GameNamespace,
  RoomEmitterTarget,
  RuntimeEmitter,
  TypedIoServer,
} from './types/types-socket.js';

const createServer = async (): Promise<void> => {
  const redis = await connectRedis();

  const emitterRef: { current: RoomEmitterTarget | null } = { current: null };
  const lazyEmitter: RoomEmitterTarget = {
    to: (roomId) => {
      if (!emitterRef.current) {
        throw new Error('Socket.IO namespace is not ready yet');
      }
      return emitterRef.current.to(roomId);
    },
  };

  const roomManager = new RoomManager(
    (roomId) => deleteRoomState(redis, roomId),
    async (roomId, playerId) => {
      // TODO: доделать при реализации игрового цикла (обработка истечения реконнект-окна во время игры)
      const state = await getRoomState(redis, roomId);
      if (!state) {
        return;
      }

      const updatedState: RoomState = {
        ...state,
        players: state.players.filter((player) => player.id !== playerId),
      };

      await saveRoomState(redis, updatedState);
      emitToRoom(lazyEmitter, roomId, 'score_update', createScoreUpdateEvent(updatedState));
    },
  );

  const httpServer = http.createServer(
    createHttpHandler({
      redis,
      roomManager,
      clientOrigin: env.CLIENT_ORIGIN,
      rateLimiter: new HttpRateLimiter(env.HTTP_CREATE_ROOM_RATE_LIMIT),
      trustProxy: env.TRUST_PROXY,
    }),
  );

  const io: TypedIoServer = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_ORIGIN,
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: WS_MAX_PAYLOAD_BYTES,
    pingInterval: 10_000,
    pingTimeout: 20_000,
  });

  const namespace: GameNamespace = io.of(gameNamespace);
  emitterRef.current = {
    to: (roomId) => namespace.to(roomId) as unknown as RuntimeEmitter,
  };

  const gameEngine = new GameEngine(redis, lazyEmitter, { namespace });

  registerGameHandlers({
    io: namespace,
    roomEmitterTarget: lazyEmitter,
    redis,
    roomManager,
    gameEngine,
  });

  httpServer.listen(env.PORT, env.HOST, () => {
    console.log(`Server listening on ${env.HOST}:${env.PORT}`);
  });

  const shutdown = async (): Promise<void> => {
    await io.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    if (redis.isOpen) {
      await redis.quit();
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
};

void createServer();
