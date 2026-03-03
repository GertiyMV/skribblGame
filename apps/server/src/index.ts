import { SHARED_PACKAGE_NAME, type SharedMessage } from '@skribbl/shared';

const createServerMessage = (): SharedMessage => ({
  type: 'server:init',
  payload: { source: SHARED_PACKAGE_NAME },
});

void createServerMessage;
