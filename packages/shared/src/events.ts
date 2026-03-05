import type { ClientToServerEventPayloads, ServerToClientEventPayloads } from './schemas/events.js';

export type ClientToServerEvents = {
  [K in keyof ClientToServerEventPayloads]: (payload: ClientToServerEventPayloads[K]) => void;
};

export type ServerToClientEvents = {
  [K in keyof ServerToClientEventPayloads]: (payload: ServerToClientEventPayloads[K]) => void;
};
