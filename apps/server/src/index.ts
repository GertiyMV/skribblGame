import { SHARED_PACKAGE_NAME, type GameState, type SharedMessage } from '@skribbl/shared';

const createServerMessage = (): SharedMessage<{ source: string; state: GameState | null }> => ({
  type: 'server:init',
  payload: { source: SHARED_PACKAGE_NAME, state: null },
});

void createServerMessage;
