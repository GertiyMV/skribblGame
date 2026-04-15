import type { RoomId, ServerToClientEventPayloads } from '@skribbl/shared';
import { serverToClientSchemas } from '@skribbl/shared';

import type { GameSocket, RoomEmitterTarget, RuntimeEmitter } from '../../types/types-socket.js';

export const emitToSocket = <TEvent extends keyof ServerToClientEventPayloads>(
  socket: GameSocket,
  event: TEvent,
  payload: ServerToClientEventPayloads[TEvent],
): void => {
  const result = serverToClientSchemas[event].safeParse(payload);

  if (!result.success) {
    console.error(
      `Attempted to emit invalid payload for "${String(event)}"`,
      result.error.flatten(),
    );
    return;
  }

  (socket as unknown as RuntimeEmitter).emit(String(event), result.data);
};

export const emitToRoom = <TEvent extends keyof ServerToClientEventPayloads>(
  roomEmitterTarget: RoomEmitterTarget,
  roomId: RoomId,
  event: TEvent,
  payload: ServerToClientEventPayloads[TEvent],
): void => {
  const result = serverToClientSchemas[event].safeParse(payload);

  if (!result.success) {
    console.error(
      `Attempted to broadcast invalid payload for "${String(event)}"`,
      result.error.flatten(),
    );
    return;
  }

  roomEmitterTarget.to(roomId).emit(String(event), result.data);
};
