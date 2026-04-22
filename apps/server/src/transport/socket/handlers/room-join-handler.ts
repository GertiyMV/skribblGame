import { randomUUID } from 'node:crypto';

import { type ClientToServerEventPayloads, GamePhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import {
  calculateTotalMiniRounds,
  getRoomState,
  saveRoomState,
} from '../../../repositories/room-repository.js';
import { saveSession } from '../../../repositories/session-repository.js';
import { RoomManager } from '../../../services/game/room-manager.js';
import { attachSocketSession, tryReconnect } from '../../../services/game/session-service.js';
import type { RoomState } from '../../../types/types-game.js';
import type { PlayerSession } from '../../../types/types-session.js';
import type { GameNamespace, GameSocket, RoomEmitterTarget } from '../../../types/types-socket.js';
import { emitToRoom, emitToSocket } from '../emitter.js';
import {
  createPlayerJoinedEvent,
  createScoreUpdateEvent,
  createSessionReadyEvent,
} from '../event-factories.js';
import { emitJoinError } from './room-handler-errors.js';

const canJoinLobby = (
  state: RoomState,
  nickname: string,
):
  | { code: null; message: null }
  | {
      code: 'game_in_progress' | 'room_full' | 'nickname_taken';
      message: string;
    } => {
  if (state.phase !== GamePhase.Lobby) {
    return {
      code: 'game_in_progress',
      message: 'Game already in progress',
    };
  }

  if (state.players.length >= state.settings.maxPlayers) {
    return {
      code: 'room_full',
      message: 'Room is full',
    };
  }

  const existingWithSameNickname = state.players.find(
    (player) => player.nickname.toLowerCase() === nickname.toLowerCase(),
  );
  if (existingWithSameNickname) {
    return {
      code: 'nickname_taken',
      message: 'Nickname is already taken in this room',
    };
  }

  return { code: null, message: null };
};

const createJoinedPlayerState = (
  state: RoomState,
  nickname: string,
): {
  updatedState: RoomState;
  session: PlayerSession;
} => {
  const playerId = randomUUID();
  const sessionId = randomUUID();

  const updatedState: RoomState = {
    ...state,
    totalMiniRounds: calculateTotalMiniRounds(state.settings.roundsCount, state.players.length + 1),
    players: [
      ...state.players,
      {
        id: playerId,
        nickname,
        score: 0,
        isOwner: false,
        guessed: false,
        connectionStatus: 'connected',
        role: 'guessing',
      },
    ],
  };

  return {
    updatedState,
    session: {
      sessionId,
      roomId: updatedState.roomId,
      playerId,
      nickname,
    },
  };
};

export const handleJoinRoom = async (params: {
  io: GameNamespace;
  roomEmitterTarget: RoomEmitterTarget;
  socket: GameSocket;
  redis: RedisClientType;
  roomManager: RoomManager;
  payload: ClientToServerEventPayloads['join_room'];
}): Promise<void> => {
  const { io, roomEmitterTarget, socket, redis, roomManager, payload } = params;

  const reconnected = await tryReconnect({ io, roomEmitterTarget, socket, redis, payload });
  if (reconnected) {
    const { playerId, roomId } = socket.data;
    if (playerId && roomId) {
      roomManager.addPlayer(roomId, playerId);
    }
    return;
  }

  const state = await getRoomState(redis, payload.roomId);
  if (!state) {
    emitJoinError(socket, payload.roomId, 'room_not_found', 'Room not found');
    return;
  }

  const joinError = canJoinLobby(state, payload.nickname);
  if (joinError.code) {
    emitJoinError(socket, state.roomId, joinError.code, joinError.message!);
    return;
  }

  const { updatedState, session } = createJoinedPlayerState(state, payload.nickname);

  await saveRoomState(redis, updatedState);
  await saveSession(redis, session);

  socket.join(updatedState.roomId);
  attachSocketSession(socket, session);
  roomManager.addPlayer(updatedState.roomId, session.playerId);

  emitToSocket(
    socket,
    'session_ready',
    createSessionReadyEvent({
      roomId: updatedState.roomId,
      playerId: session.playerId,
      reconnectToken: session.sessionId,
      state: updatedState,
    }),
  );
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'player_joined',
    createPlayerJoinedEvent(updatedState, session.playerId),
  );
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'score_update',
    createScoreUpdateEvent(updatedState),
  );
};
