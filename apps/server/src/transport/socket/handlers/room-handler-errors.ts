import type { GuessResultErrorCode, GameSocket } from '../../../types/types-socket.js';
import { emitToSocket } from '../emitter.js';
import { createJoinErrorEvent } from '../event-factories.js';

export const emitJoinError = (
  socket: GameSocket,
  roomId: string,
  code: GuessResultErrorCode,
  message: string,
): void => {
  emitToSocket(
    socket,
    'guess_result',
    createJoinErrorEvent({
      roomId,
      code,
      message,
    }),
  );
};
