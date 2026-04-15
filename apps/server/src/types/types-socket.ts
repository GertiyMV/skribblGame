import type {
  ClientToServerEvents,
  PlayerId,
  RoomId,
  ServerToClientEventPayloads,
  ServerToClientEvents,
} from '@skribbl/shared';
import type { Namespace, Server, Socket } from 'socket.io';

import type { SessionId } from './types-session.js';

export type SocketData = {
  playerId?: PlayerId;
  roomId?: RoomId;
  sessionId?: SessionId;
};

export type TypedIoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type GameNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export type GuessResultErrorCode = Extract<
  ServerToClientEventPayloads['guess_result'],
  { ok: false }
>['error']['code'];

export type RuntimeEmitter = {
  emit: (event: string, payload: unknown) => void;
};

export type RoomEmitterTarget = {
  to: (roomId: RoomId) => RuntimeEmitter;
};
