import type { ClientToServerEventPayloads } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import { RoomManager } from '../../../services/game/room-manager.js';
import { createRoomWithOwner } from '../../../services/game/room-service.js';
import { attachSocketSession } from '../../../services/game/session-service.js';
import type { GameSocket, RoomEmitterTarget } from '../../../types/types-socket.js';
import { emitToSocket } from '../emitter.js';
import {
  createPlayerJoinedEvent,
  createScoreUpdateEvent,
  createSessionReadyEvent,
} from '../event-factories.js';

export const handleCreateRoom = async (params: {
  socket: GameSocket;
  redis: RedisClientType;
  roomManager: RoomManager;
  payload: ClientToServerEventPayloads['create_room'];
}): Promise<void> => {
  const { socket, redis, roomManager, payload } = params;

  const { state, session } = await createRoomWithOwner(
    { nickname: payload.nickname, settingsOverride: payload.settingsOverride },
    { redis, roomManager },
  );

  socket.join(state.roomId);
  attachSocketSession(socket, session);
  roomManager.addPlayer(state.roomId, session.playerId);

  emitToSocket(
    socket,
    'session_ready',
    createSessionReadyEvent({
      roomId: state.roomId,
      playerId: session.playerId,
      reconnectToken: session.sessionId,
      state,
    }),
  );
  emitToSocket(socket, 'player_joined', createPlayerJoinedEvent(state, session.playerId));
  emitToSocket(socket, 'score_update', createScoreUpdateEvent(state));
};
