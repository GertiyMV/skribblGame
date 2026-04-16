import type { RedisClientType } from 'redis';

import {
  DEFAULT_HINTS_COUNT,
  DEFAULT_ROOM_MAX_PLAYERS,
  DEFAULT_ROUND_TIME_SEC,
  DEFAULT_ROUNDS_COUNT,
  DEFAULT_WORD_CHOICES,
  GamePhase,
  type Nickname,
  type PlayerId,
  type Player,
  RoundPhase,
  type RoomId,
  type RoomSettings,
  type ClientToServerEventPayloads,
} from '@skribbl/shared';

import type { RoomState } from '../types/types-game.js';

const roomKey = (roomId: RoomId): string => `skribbl:room:${roomId}`;

export const calculateTotalMiniRounds = (roundsCount: number, playersCount: number): number =>
  roundsCount * playersCount;

export const createInitialRoomState = (params: {
  roomId: RoomId;
  ownerPlayerId: PlayerId;
  ownerNickname: Nickname;
  settingsOverride?: ClientToServerEventPayloads['create_room']['settingsOverride'];
}): RoomState => {
  const nowIso = new Date().toISOString();
  const settings: RoomSettings = {
    maxPlayers: params.settingsOverride?.maxPlayers ?? DEFAULT_ROOM_MAX_PLAYERS,
    roundTimeSec:
      (params.settingsOverride?.roundTimeSec as RoomSettings['roundTimeSec'] | undefined) ??
      DEFAULT_ROUND_TIME_SEC,
    roundsCount: params.settingsOverride?.roundsCount ?? DEFAULT_ROUNDS_COUNT,
    wordChoicesCount: params.settingsOverride?.wordChoicesCount ?? DEFAULT_WORD_CHOICES,
    hintsCount: params.settingsOverride?.hintsCount ?? DEFAULT_HINTS_COUNT,
    language: 'ru',
    wordDifficulty: params.settingsOverride?.wordDifficulty ?? 'medium',
    useCustomWordsOnly: false,
  };

  const players: Player[] = [
    {
      id: params.ownerPlayerId,
      nickname: params.ownerNickname,
      score: 0,
      isOwner: true,
      guessed: false,
      connectionStatus: 'connected',
      role: 'guessing',
    },
  ];

  return {
    roomId: params.roomId,
    phase: GamePhase.Lobby,
    roundPhase: RoundPhase.RoundEnd,
    miniRoundNumber: 0,
    totalMiniRounds: calculateTotalMiniRounds(settings.roundsCount, players.length),
    leaderPlayerId: params.ownerPlayerId,
    roundEndAt: nowIso,
    wordOptions: [],
    word: '',
    wordMask: '',
    wordLength: 0,
    hintsUsed: 0,
    hintsTotal: settings.hintsCount,
    players,
    settings,
    roundParticipantsCount: players.length,
  };
};

export const saveRoomState = async (redis: RedisClientType, state: RoomState): Promise<void> => {
  const key = roomKey(state.roomId);
  await redis.set(key, JSON.stringify(state));
};

export const getRoomState = async (
  redis: RedisClientType,
  roomId: RoomId,
): Promise<RoomState | null> => {
  const key = roomKey(roomId);
  const json = await redis.get(key);

  if (!json) {
    return null;
  }

  return JSON.parse(json) as RoomState;
};

export const deleteRoomState = async (redis: RedisClientType, roomId: RoomId): Promise<void> => {
  const key = roomKey(roomId);
  await redis.del(key);
};
