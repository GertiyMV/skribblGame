import { SHARED_PACKAGE_NAME, type SharedMessage } from '@skribbl/shared';

const createClientMessage = (): SharedMessage => ({
  type: 'client:init',
  payload: { source: SHARED_PACKAGE_NAME },
});

void createClientMessage;
