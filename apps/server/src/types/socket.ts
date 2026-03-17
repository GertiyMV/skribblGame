import type {
  ClientToServerEvents,
  ServerToClientEventPayloads,
  ServerToClientEvents,
} from '@skribbl/shared';
import type { Namespace, Server, Socket } from 'socket.io';

export type SocketData = {
  playerId?: string;
  roomId?: string;
  sessionId?: string;
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
  to: (roomId: string) => RuntimeEmitter;
};
