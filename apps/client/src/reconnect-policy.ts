const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000] as const;
const RECONNECT_MAX_DELAY_MS = 10_000;

export const getReconnectDelayMs = (attempt: number): number => {
  const sequenceDelay = RECONNECT_DELAYS_MS[Math.max(0, attempt - 1)] ?? RECONNECT_MAX_DELAY_MS;
  return Math.min(sequenceDelay, RECONNECT_MAX_DELAY_MS);
};
