import type { GameSocket } from '../../../types/types-socket.js';
import type { PlayerSession } from '../../../types/types-session.js';

export const attachSocketSession = (socket: GameSocket, session: PlayerSession): void => {
  socket.data.playerId = session.playerId;
  socket.data.roomId = session.roomId;
  socket.data.sessionId = session.sessionId;
};
