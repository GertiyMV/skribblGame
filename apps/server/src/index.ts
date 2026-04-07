import http from 'node:http';

import { WS_MAX_PAYLOAD_BYTES } from '@skribbl/shared';
import { Server } from 'socket.io';

import { gameNamespace } from './constants/socket.js';
import { env } from './config/env.js';
import { deleteRoomState } from './repositories/room-repository.js';
import { RoomManager } from './services/game/room-manager.js';
import { connectRedis } from './services/redis/client.js';
import { registerGameHandlers } from './transport/socket/register-game-handlers.js';
import type {
  GameNamespace,
  RoomEmitterTarget,
  RuntimeEmitter,
  TypedIoServer,
} from './types/socket.js';

const createServer = async (): Promise<void> => {
  const redis = await connectRedis();
  const roomManager = new RoomManager((roomId) => deleteRoomState(redis, roomId));

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
