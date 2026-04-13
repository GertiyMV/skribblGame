import { z } from 'zod';

import {
  drawPointsSchema,
  eventIdSchema,
  gameStateSchema,
  hexColorSchema,
  messageIdSchema,
  messageTextSchema,
  nicknameSchema,
  playerIdSchema,
  roomIdSchema,
  roomSettingsOverrideSchema,
  scoreEntrySchema,
  strokeIdSchema,
  timestampSchema,
  wordSchema,
  brushSizeSchema,
} from './common.js';

const drawToolSchema = z.enum(['brush', 'eraser', 'fill', 'clear']);

const clientCreateRoomSchema = z.object({
  nickname: nicknameSchema,
  settingsOverride: roomSettingsOverrideSchema.optional(),
});

const clientJoinRoomSchema = z.object({
  roomId: roomIdSchema,
  nickname: nicknameSchema,
  reconnectToken: z.string().trim().min(1).optional(),
});

const clientStartGameSchema = z.object({
  roomId: roomIdSchema,
});

const clientChooseWordSchema = z.object({
  roomId: roomIdSchema,
  word: wordSchema,
});

const clientDrawSchema = z.object({
  roomId: roomIdSchema,
  strokeId: strokeIdSchema,
  tool: drawToolSchema,
  color: hexColorSchema,
  size: brushSizeSchema,
  points: drawPointsSchema,
  isFinal: z.boolean(),
});

const clientGuessSchema = z.object({
  roomId: roomIdSchema,
  messageId: messageIdSchema,
  text: messageTextSchema,
});

const eventMetaSchema = z.object({
  eventId: eventIdSchema,
  ts: timestampSchema,
  roomId: roomIdSchema,
});

const serverPlayerSchema = z.object({
  playerId: playerIdSchema,
  nickname: nicknameSchema,
  score: z.number().int().min(0),
  isOwner: z.boolean(),
  guessed: z.boolean(),
});

const serverPlayerJoinedSchema = eventMetaSchema.extend({
  player: serverPlayerSchema,
  playersCount: z.number().int().min(1),
});

const serverSessionReadySchema = eventMetaSchema.extend({
  playerId: playerIdSchema,
  reconnectToken: z.string().trim().min(1),
  state: gameStateSchema,
});

const serverPlayerLeftSchema = eventMetaSchema.extend({
  playerId: playerIdSchema,
  reason: z.enum(['disconnect', 'leave', 'kick', 'timeout']),
  playersCount: z.number().int().min(0),
});

const serverRoundStartWordSelectionSchema = eventMetaSchema.extend({
  phase: z.literal('word_selection'),
  miniRoundNumber: z.number().int().min(1),
  totalMiniRounds: z.number().int().min(1),
  leaderPlayerId: playerIdSchema,
  roundEndAt: timestampSchema,
  wordOptions: z.array(wordSchema),
  wordMask: z.literal(''),
  wordLength: z.literal(0),
});

const serverRoundStartDrawingSchema = eventMetaSchema.extend({
  phase: z.literal('drawing'),
  miniRoundNumber: z.number().int().min(1),
  totalMiniRounds: z.number().int().min(1),
  leaderPlayerId: playerIdSchema,
  roundEndAt: timestampSchema,
  wordOptions: z.array(wordSchema).length(0),
  wordMask: z.string().trim().min(1),
  wordLength: z.number().int().min(1),
});

const serverRoundStartSchema = z.discriminatedUnion('phase', [
  serverRoundStartWordSelectionSchema,
  serverRoundStartDrawingSchema,
]);

const serverDrawUpdateSchema = eventMetaSchema.extend({
  playerId: playerIdSchema,
  strokeId: strokeIdSchema,
  tool: drawToolSchema,
  color: hexColorSchema,
  size: brushSizeSchema,
  points: drawPointsSchema,
  isFinal: z.boolean(),
});

const serverHintUpdateSchema = eventMetaSchema.extend({
  mask: z.string().trim().min(1),
  hintsUsed: z.number().int().min(0),
  hintsTotal: z.number().int().min(0),
});

const serverGuessResultSuccessSchema = eventMetaSchema.extend({
  playerId: playerIdSchema,
  messageId: messageIdSchema,
  ok: z.literal(true),
  result: z.enum(['correct', 'incorrect', 'near_miss', 'blocked']),
  awardedScore: z.number().int().min(0).optional(),
  position: z.number().int().min(1).optional(),
});

const serverGuessResultErrorSchema = eventMetaSchema.extend({
  playerId: playerIdSchema,
  messageId: messageIdSchema,
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      'room_not_found',
      'room_full',
      'game_in_progress',
      'invalid_nickname',
      'nickname_taken',
      'forbidden_action',
      'invalid_payload',
      'rate_limit_exceeded',
    ]),
    message: z.string().trim().min(1),
  }),
});

const serverScoreUpdateSchema = eventMetaSchema.extend({
  scores: z.array(scoreEntrySchema).min(1),
});

const serverWordRevealSchema = eventMetaSchema.extend({
  word: wordSchema,
  leaderPlayerId: playerIdSchema,
});

const serverRoundEndSchema = eventMetaSchema.extend({
  miniRoundNumber: z.number().int().min(1),
  reason: z.enum(['time_over', 'all_guessed', 'only_leader_left', 'leader_disconnected']),
  nextLeaderPlayerId: playerIdSchema,
});

const serverGameOverSchema = eventMetaSchema.extend({
  winners: z.array(playerIdSchema).min(1),
  finalScores: z.array(scoreEntrySchema).min(1),
});

export const clientToServerSchemas = {
  create_room: clientCreateRoomSchema,
  join_room: clientJoinRoomSchema,
  start_game: clientStartGameSchema,
  choose_word: clientChooseWordSchema,
  draw: clientDrawSchema,
  guess: clientGuessSchema,
} as const;

export const serverToClientSchemas = {
  player_joined: serverPlayerJoinedSchema,
  session_ready: serverSessionReadySchema,
  player_left: serverPlayerLeftSchema,
  round_start: serverRoundStartSchema,
  draw_update: serverDrawUpdateSchema,
  hint_update: serverHintUpdateSchema,
  guess_result: z.discriminatedUnion('ok', [
    serverGuessResultSuccessSchema,
    serverGuessResultErrorSchema,
  ]),
  score_update: serverScoreUpdateSchema,
  word_reveal: serverWordRevealSchema,
  round_end: serverRoundEndSchema,
  game_over: serverGameOverSchema,
} as const;

export type ClientToServerEventPayloads = {
  [K in keyof typeof clientToServerSchemas]: z.infer<(typeof clientToServerSchemas)[K]>;
};

export type ServerToClientEventPayloads = {
  [K in keyof typeof serverToClientSchemas]: z.infer<(typeof serverToClientSchemas)[K]>;
};
