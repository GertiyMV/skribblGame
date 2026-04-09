import http from 'node:http';

import { WS_MAX_PAYLOAD_BYTES } from '@skribbl/shared';
import { Server } from 'socket.io';

import { gameNamespace } from './constants/socket.js';
import { env } from './config/env.js';
import {
  deleteRoomState,
  getRoomState,
  saveRoomState,
  type RoomState,
} from './repositories/room-repository.js';
import { RoomManager } from './services/game/room-manager.js';
import { connectRedis } from './services/redis/client.js';
import { emitToRoom } from './transport/socket/emitter.js';
import { createScoreUpdateEvent } from './transport/socket/event-factories.js';
import { registerGameHandlers } from './transport/socket/register-game-handlers.js';
import type {
  GameNamespace,
  RoomEmitterTarget,
  RuntimeEmitter,
  TypedIoServer,
} from './types/socket.js';

const createServer = async (): Promise<void> => {
  const redis = await connectRedis();

  const httpServer = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

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
  const roomEmitterTarget: RoomEmitterTarget = {
    to: (roomId) => namespace.to(roomId) as unknown as RuntimeEmitter,
  };

  const roomManager = new RoomManager(
    (roomId) => deleteRoomState(redis, roomId),
    async (roomId, playerId) => {
      // TODO: доделать при реализации game loop (обработка истечения реконнект-окна во время игры)
      const state = await getRoomState(redis, roomId);
      if (!state) {
        return;
      }

      const updatedState: RoomState = {
        ...state,
        players: state.players.filter((player) => player.id !== playerId),
      };

      await saveRoomState(redis, updatedState);
      emitToRoom(roomEmitterTarget, roomId, 'score_update', createScoreUpdateEvent(updatedState));
    },
  );

  registerGameHandlers({ io: namespace, roomEmitterTarget, redis, roomManager });

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
