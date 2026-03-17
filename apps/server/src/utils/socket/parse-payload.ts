import type { ClientToServerEventPayloads } from '@skribbl/shared';
import { clientToServerSchemas } from '@skribbl/shared';

export const parsePayload = <TEvent extends keyof ClientToServerEventPayloads>(
  event: TEvent,
  payload: unknown,
): ClientToServerEventPayloads[TEvent] | null => {
  const result = clientToServerSchemas[event].safeParse(payload);

  if (!result.success) {
    console.warn(`Invalid payload for event "${String(event)}"`, result.error.flatten());
    return null;
  }

  return result.data as ClientToServerEventPayloads[TEvent];
};
