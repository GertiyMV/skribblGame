import { randomUUID } from 'node:crypto';

import type { ClientToServerEventPayloads } from '@skribbl/shared';

import { getRoomState, saveRoomState } from '../../../repositories/room-repository.js';
import { getSession, replaceSession } from '../../../repositories/session-repository.js';
import type { RoomState } from '../../../types/types-game.js';
import type { PlayerSession } from '../../../types/types-session.js';
import type { GameNamespace, GameSocket, RoomEmitterTarget } from '../../../types/types-socket.js';
import { emitToRoom, emitToSocket } from '../../../transport/socket/emitter.js';
import {
  createPlayerJoinedEvent,
  createScoreUpdateEvent,
  createSessionReadyEvent,
} from '../../../transport/socket/event-factories.js';
import { attachSocketSession } from './session-socket.js';

const hasMatchingReconnectPayload = (
  session: PlayerSession,
  payload: ClientToServerEventPayloads['join_room'],
): boolean =>
  session.roomId === payload.roomId &&
  session.nickname.toLowerCase() === payload.nickname.toLowerCase();

const createReconnectedState = (
  roomState: RoomState,
  session: PlayerSession,
): { updatedState: RoomState; nextSession: PlayerSession } | null => {
  const playerIndex = roomState.players.findIndex((player) => player.id === session.playerId);
  if (playerIndex === -1) {
    return null;
  }

  return {
    updatedState: {
      ...roomState,
      players: roomState.players.map((player, index) =>
        index === playerIndex
          ? {
              ...player,
              connectionStatus: 'connected',
            }
          : player,
      ),
    },
    nextSession: {
      ...session,
      sessionId: randomUUID(),
    },
  };
};

const disconnectDuplicateSockets = async (
  io: GameNamespace,
  socket: GameSocket,
  roomId: string,
  playerId: string,
): Promise<void> => {
  const socketsInRoom = await io.in(roomId).fetchSockets();
  for (const connectedSocket of socketsInRoom) {
    if (connectedSocket.id === socket.id) {
      continue;
    }

    if (connectedSocket.data.playerId === playerId) {
      connectedSocket.disconnect(true);
    }
  }
};

export const tryReconnect = async (params: {
  io: GameNamespace;
  roomEmitterTarget: RoomEmitterTarget;
  socket: GameSocket;
  redis: import('redis').RedisClientType;
  payload: ClientToServerEventPayloads['join_room'];
}): Promise<boolean> => {
  const { io, roomEmitterTarget, socket, redis, payload } = params;

  if (!payload.reconnectToken) {
    return false;
  }

  const session = await getSession(redis, payload.reconnectToken);
  if (!session || !hasMatchingReconnectPayload(session, payload)) {
    return false;
  }

  const roomState = await getRoomState(redis, session.roomId);
  if (!roomState) {
    return false;
  }

  const reconnectState = createReconnectedState(roomState, session);
  if (!reconnectState) {
    return false;
  }

  const { updatedState, nextSession } = reconnectState;

  await saveRoomState(redis, updatedState);
  await replaceSession(redis, session.sessionId, nextSession);
  await disconnectDuplicateSockets(io, socket, updatedState.roomId, nextSession.playerId);

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
