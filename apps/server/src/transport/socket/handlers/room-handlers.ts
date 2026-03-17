import { randomUUID } from 'node:crypto';

import { type ClientToServerEventPayloads, GamePhase } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import {
  calculateTotalMiniRounds,
  createInitialRoomState,
  getRoomState,
  saveRoomState,
  type RoomState,
} from '../../../repositories/room-repository.js';
import {
  getSession,
  saveSession,
  type PlayerSession,
} from '../../../repositories/session-repository.js';
import { createUniqueRoomId } from '../../../services/game/room-service.js';
import { attachSocketSession, tryReconnect } from '../../../services/game/session-service.js';
import type { GameSocket, RoomEmitterTarget } from '../../../types/socket.js';
import { emitToRoom, emitToSocket } from '../emitter.js';
import {
  createJoinErrorEvent,
  createPlayerJoinedEvent,
  createPlayerLeftEvent,
  createScoreUpdateEvent,
  createSessionReadyEvent,
} from '../event-factories.js';

export const handleCreateRoom = async (params: {
  socket: GameSocket;
  redis: RedisClientType;
  payload: ClientToServerEventPayloads['create_room'];
}): Promise<void> => {
  const { socket, redis, payload } = params;

  const roomId = await createUniqueRoomId(redis);
  const playerId = randomUUID();
  const sessionId = randomUUID();

  const state = createInitialRoomState({
    roomId,
    ownerPlayerId: playerId,
    ownerNickname: payload.nickname,
    settingsOverride: payload.settingsOverride,
  });

  const session: PlayerSession = {
    sessionId,
    roomId,
    playerId,
    nickname: payload.nickname,
  };

  await saveRoomState(redis, state);
  await saveSession(redis, session);

  socket.join(roomId);
  attachSocketSession(socket, session);

  emitToSocket(
    socket,
    'session_ready',
    createSessionReadyEvent({ roomId, playerId, reconnectToken: sessionId, state }),
  );
  emitToSocket(socket, 'player_joined', createPlayerJoinedEvent(state, playerId));
  emitToSocket(socket, 'score_update', createScoreUpdateEvent(state));
};

export const handleJoinRoom = async (params: {
  roomEmitterTarget: RoomEmitterTarget;
  socket: GameSocket;
  redis: RedisClientType;
  payload: ClientToServerEventPayloads['join_room'];
}): Promise<void> => {
  const { roomEmitterTarget, socket, redis, payload } = params;

  const reconnected = await tryReconnect({ roomEmitterTarget, socket, redis, payload });
  if (reconnected) {
    return;
  }

  const state = await getRoomState(redis, payload.roomId);
  if (!state) {
    emitToSocket(
      socket,
      'guess_result',
      createJoinErrorEvent({
        roomId: payload.roomId,
        code: 'room_not_found',
        message: 'Room not found',
      }),
    );
    return;
  }

  if (state.phase !== GamePhase.Lobby) {
    emitToSocket(
      socket,
      'guess_result',
      createJoinErrorEvent({
        roomId: state.roomId,
        code: 'game_in_progress',
        message: 'Game already in progress',
      }),
    );
    return;
  }

  if (state.players.length >= state.settings.maxPlayers) {
    emitToSocket(
      socket,
      'guess_result',
      createJoinErrorEvent({
        roomId: state.roomId,
        code: 'room_full',
        message: 'Room is full',
      }),
    );
    return;
  }

  const existingWithSameNickname = state.players.find(
    (player) => player.nickname.toLowerCase() === payload.nickname.toLowerCase(),
  );

  if (existingWithSameNickname) {
    emitToSocket(
      socket,
      'guess_result',
      createJoinErrorEvent({
        roomId: state.roomId,
        code: 'nickname_taken',
        message: 'Nickname is already taken in this room',
      }),
    );
    return;
  }

  const playerId = randomUUID();
  const sessionId = randomUUID();

  const updatedState: RoomState = {
    ...state,
    totalMiniRounds: calculateTotalMiniRounds(state.settings.roundsCount, state.players.length + 1),
    players: [
      ...state.players,
      {
        id: playerId,
        nickname: payload.nickname,
        score: 0,
        isOwner: false,
        guessed: false,
        connectionStatus: 'connected',
        role: 'guessing',
      },
    ],
  };

  const session: PlayerSession = {
    sessionId,
    roomId: updatedState.roomId,
    playerId,
    nickname: payload.nickname,
  };

  await saveRoomState(redis, updatedState);
  await saveSession(redis, session);

  socket.join(updatedState.roomId);
  attachSocketSession(socket, session);

  emitToSocket(
    socket,
    'session_ready',
    createSessionReadyEvent({
      roomId: updatedState.roomId,
      playerId,
      reconnectToken: sessionId,
      state: updatedState,
    }),
  );
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'player_joined',
    createPlayerJoinedEvent(updatedState, playerId),
  );
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'score_update',
    createScoreUpdateEvent(updatedState),
  );
};

export const handleDisconnect = async (
  roomEmitterTarget: RoomEmitterTarget,
  socket: GameSocket,
  redis: RedisClientType,
): Promise<void> => {
  const { playerId, roomId, sessionId } = socket.data;

  if (!playerId || !roomId || !sessionId) {
    return;
  }

  const activeSession = await getSession(redis, sessionId);
  if (!activeSession || activeSession.playerId !== playerId || activeSession.roomId !== roomId) {
    return;
  }

  const state = await getRoomState(redis, roomId);
  if (!state) {
    return;
  }

  const updatedState: RoomState = {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            connectionStatus: 'disconnected',
          }
        : player,
    ),
  };

  await saveRoomState(redis, updatedState);
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'player_left',
    createPlayerLeftEvent({ state: updatedState, playerId, reason: 'disconnect' }),
  );
};
