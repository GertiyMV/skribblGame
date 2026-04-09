import { z } from 'zod';

import {
  DRAW_MAX_POINTS_PER_MESSAGE,
  HINTS_COUNT_MAX,
  HINTS_COUNT_MIN,
  PLAYER_NICKNAME_MAX_LENGTH,
  PLAYER_NICKNAME_MIN_LENGTH,
  ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_MIN_LENGTH,
  ROOM_MAX_PLAYERS_MAX,
  ROOM_MAX_PLAYERS_MIN,
  ROUNDS_COUNT_MAX,
  ROUNDS_COUNT_MIN,
  ROUND_TIME_OPTIONS_SEC,
} from '../constants.js';
import { GamePhase, RoundPhase } from '../types.js';

export const roomIdSchema = z
  .string()
  .trim()
  .regex(
    new RegExp(`^[A-Z0-9]{${ROOM_CODE_MIN_LENGTH},${ROOM_CODE_MAX_LENGTH}}$`),
    'Invalid roomId',
  );

export const nicknameSchema = z
  .string()
  .trim()
  .min(PLAYER_NICKNAME_MIN_LENGTH)
  .max(PLAYER_NICKNAME_MAX_LENGTH);

export const wordSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[\p{L}\s-]+$/u, 'Word must contain only letters, spaces, or hyphen');

export const messageTextSchema = z.string().trim().min(1).max(64);

export const eventIdSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });

export const playerIdSchema = z.string().trim().min(1);
export const strokeIdSchema = z.string().trim().min(1);
export const messageIdSchema = z.string().trim().min(1);

export const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color');
export const brushSizeSchema = z.number().int().min(1).max(64);
export const finiteNumberSchema = z.number();

export const drawPointSchema = z.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  t: finiteNumberSchema.nonnegative(),
});

export const drawPointsSchema = z.array(drawPointSchema).min(1).max(DRAW_MAX_POINTS_PER_MESSAGE);

export const roundTimeSecSchema = z
  .number()
  .int()
  .refine(
    (value) => ROUND_TIME_OPTIONS_SEC.includes(value as (typeof ROUND_TIME_OPTIONS_SEC)[number]),
    {
      message: 'Invalid roundTimeSec',
    },
  );

export const roomSettingsOverrideSchema = z.object({
  maxPlayers: z.number().int().min(ROOM_MAX_PLAYERS_MIN).max(ROOM_MAX_PLAYERS_MAX).optional(),
  roundsCount: z.number().int().min(ROUNDS_COUNT_MIN).max(ROUNDS_COUNT_MAX).optional(),
  roundTimeSec: roundTimeSecSchema.optional(),
  hintsCount: z.number().int().min(HINTS_COUNT_MIN).max(HINTS_COUNT_MAX).optional(),
});

export const scoreEntrySchema = z.object({
  playerId: playerIdSchema,
  score: z.number().int().min(0),
});

export const connectionStatusSchema = z.enum(['connected', 'disconnected']);

export const playerRoleSchema = z.enum(['guessing', 'drawing', 'spectator']);

export const playerSchema = z.object({
  id: playerIdSchema,
  nickname: nicknameSchema,
  score: z.number().int().min(0),
  isOwner: z.boolean(),
  guessed: z.boolean(),
  connectionStatus: connectionStatusSchema,
  role: playerRoleSchema,
});

export const roomSettingsSchema = z.object({
  maxPlayers: z.number().int().min(ROOM_MAX_PLAYERS_MIN).max(ROOM_MAX_PLAYERS_MAX),
  roundTimeSec: roundTimeSecSchema,
  roundsCount: z.number().int().min(ROUNDS_COUNT_MIN).max(ROUNDS_COUNT_MAX),
  wordChoicesCount: z.number().int().min(1),
  hintsCount: z.number().int().min(HINTS_COUNT_MIN).max(HINTS_COUNT_MAX),
  language: z.literal('ru'),
  customWords: z.array(z.string().trim().min(1)).optional(),
  useCustomWordsOnly: z.boolean(),
});

export const gameStateSchema = z.object({
  roomId: roomIdSchema,
  phase: z.nativeEnum(GamePhase),
  roundPhase: z.nativeEnum(RoundPhase),
  miniRoundNumber: z.number().int().min(0),
  totalMiniRounds: z.number().int().min(0),
  leaderPlayerId: playerIdSchema,
  roundEndAt: timestampSchema,
  wordOptions: z.array(wordSchema),
  wordMask: z.string(),
  wordLength: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  hintsTotal: z.number().int().min(0),
  players: z.array(playerSchema),
  settings: roomSettingsSchema,
});
