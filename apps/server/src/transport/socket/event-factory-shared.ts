import type { IsoTimestamp } from '@skribbl/shared';

export const nowIso = (): IsoTimestamp => new Date().toISOString();
