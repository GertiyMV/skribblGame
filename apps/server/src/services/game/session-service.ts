import { randomUUID } from 'node:crypto';

import type { ClientToServerEventPayloads } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { getRoomState, saveRoomState } from '../../repositories/room-repository.js';
import { getSession, replaceSession } from '../../repositories/session-repository.js';
import type { RoomState } from '../../types/types-game.js';
import type { PlayerSession } from '../../types/types-session.js';
import type { GameNamespace, GameSocket, RoomEmitterTarget } from '../../types/types-socket.js';
import { emitToRoom, emitToSocket } from '../../transport/socket/emitter.js';
import {
  createPlayerJoinedEvent,
  createScoreUpdateEvent,
  createSessionReadyEvent,
} from '../../transport/socket/event-factories.js';

export const attachSocketSession = (socket: GameSocket, session: PlayerSession): void => {
  socket.data.playerId = session.playerId;
  socket.data.roomId = session.roomId;
  socket.data.sessionId = session.sessionId;
};

export const tryReconnect = async (params: {
  io: GameNamespace;
  roomEmitterTarget: RoomEmitterTarget;
  socket: GameSocket;
  redis: RedisClientType;
  payload: ClientToServerEventPayloads['join_room'];
}): Promise<boolean> => {
  const { io, roomEmitterTarget, socket, redis, payload } = params;

  if (!payload.reconnectToken) {
    return false;
  }

  const session = await getSession(redis, payload.reconnectToken);
  if (!session) {
    return false;
  }

  if (
    session.roomId !== payload.roomId ||
    session.nickname.toLowerCase() !== payload.nickname.toLowerCase()
  ) {
    return false;
  }

  const roomState = await getRoomState(redis, session.roomId);
  if (!roomState) {
    return false;
  }

  const playerIndex = roomState.players.findIndex((player) => player.id === session.playerId);
  if (playerIndex === -1) {
    return false;
  }

  const updatedState: RoomState = {
    ...roomState,
    players: roomState.players.map((player, index) =>
      index === playerIndex
        ? {
            ...player,
            connectionStatus: 'connected',
          }
        : player,
    ),
  };
  const nextSession: PlayerSession = {
    ...session,
    sessionId: randomUUID(),
  };

  await saveRoomState(redis, updatedState);
  await replaceSession(redis, session.sessionId, nextSession);

  const socketsInRoom = await io.in(updatedState.roomId).fetchSockets();
  for (const connectedSocket of socketsInRoom) {
    if (connectedSocket.id === socket.id) {
      continue;
    }

    if (connectedSocket.data.playerId === nextSession.playerId) {
      connectedSocket.disconnect(true);
    }
  }

  socket.join(updatedState.roomId);
  attachSocketSession(socket, nextSession);

  emitToSocket(
    socket,
    'session_ready',
    createSessionReadyEvent({
      roomId: updatedState.roomId,
      playerId: nextSession.playerId,
      reconnectToken: nextSession.sessionId,
      state: updatedState,
    }),
  );
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'player_joined',
    createPlayerJoinedEvent(updatedState, nextSession.playerId),
  );
  emitToSocket(socket, 'score_update', createScoreUpdateEvent(updatedState));

  return true;
};
