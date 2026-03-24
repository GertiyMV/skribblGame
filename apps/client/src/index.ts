import { SHARED_PACKAGE_NAME, type GameState, type SharedMessage } from '@skribbl/shared';
import { GameSocketClient, type GameSocketClientOptions } from './game-socket-client.js';

const createClientMessage = (): SharedMessage<{ source: string; state: GameState | null }> => ({
  type: 'client:init',
  payload: { source: SHARED_PACKAGE_NAME, state: null },
});

void createClientMessage;

export { createClientMessage, GameSocketClient };
export type { GameSocketClientOptions };
