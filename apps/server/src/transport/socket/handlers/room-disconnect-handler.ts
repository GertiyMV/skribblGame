import type { RedisClientType } from 'redis';

import { getRoomState, saveRoomState } from '../../../repositories/room-repository.js';
import { getSession, setSessionExpiry } from '../../../repositories/session-repository.js';
import { RoomManager } from '../../../services/game/room/room-manager.js';
import type { RoomState } from '../../../types/types-game.js';
import type { GameSocket, RoomEmitterTarget } from '../../../types/types-socket.js';
import { emitToRoom } from '../emitter.js';
import { createPlayerLeftEvent } from '../event-factories.js';

const createDisconnectedState = (state: RoomState, playerId: string): RoomState => ({
  ...state,
  players: state.players.map((player) =>
    player.id === playerId
      ? {
          ...player,
          connectionStatus: 'disconnected',
        }
      : player,
  ),
});

export const handleDisconnect = async (
  roomEmitterTarget: RoomEmitterTarget,
  socket: GameSocket,
  redis: RedisClientType,
  roomManager: RoomManager,
  reason: string,
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

  const updatedState = createDisconnectedState(state, playerId);

  await saveRoomState(redis, updatedState);
  await setSessionExpiry(redis, sessionId);
  roomManager.removePlayer(roomId, playerId);
  emitToRoom(
    roomEmitterTarget,
    updatedState.roomId,
    'player_left',
    createPlayerLeftEvent({
      state: updatedState,
      playerId,
      reason: reason === 'ping timeout' ? 'timeout' : 'disconnect',
    }),
  );
};
