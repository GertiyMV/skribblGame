export const PLAYER_NICKNAME_MIN_LENGTH = 2;
export const PLAYER_NICKNAME_MAX_LENGTH = 16;

export const ROOM_CODE_MIN_LENGTH = 4;
export const ROOM_CODE_MAX_LENGTH = 6;

export const ROOM_MAX_PLAYERS_MIN = 2;
export const ROOM_MAX_PLAYERS_MAX = 12;
export const DEFAULT_ROOM_MAX_PLAYERS = 8;

export const ROUND_TIME_OPTIONS_SEC = [30, 45, 60, 80, 90, 120] as const;
export const DEFAULT_ROUND_TIME_SEC = 80;

export const ROUNDS_COUNT_MIN = 1;
export const ROUNDS_COUNT_MAX = 10;
export const DEFAULT_ROUNDS_COUNT = 2;

export const WORD_CHOICES_MIN = 1;
export const WORD_CHOICES_MAX = 5;
export const DEFAULT_WORD_CHOICES = 3;

export const HINTS_COUNT_MIN = 0;
export const HINTS_COUNT_MAX = 5;
export const DEFAULT_HINTS_COUNT = 3;

export const WORD_SELECTION_DURATION_MS = 15_000;
export const ROUND_END_DURATION_MS = 5_000;

export const RECONNECT_TIMEOUT_MS = 60_000;
export const RECONNECT_MAX_ATTEMPTS = 3;

export const DRAW_MAX_POINTS_PER_MESSAGE = 200;
export const WS_MAX_PAYLOAD_BYTES = 16 * 1024;
