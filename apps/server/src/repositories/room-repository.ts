import type { RedisClientType } from 'redis';

import {
  DEFAULT_HINTS_COUNT,
  DEFAULT_WORD_CHOICES,
  DEFAULT_ROOM_MAX_PLAYERS,
  DEFAULT_ROUNDS_COUNT,
  DEFAULT_ROUND_TIME_SEC,
  type GameState,
  GamePhase,
  type Player,
  RoundPhase,
  type RoomSettings,
  type ClientToServerEventPayloads,
} from '@skribbl/shared';

export type RoomState = GameState & {
  word: string;
};

const roomKey = (roomId: string): string => `skribbl:room:${roomId}`;

export const calculateTotalMiniRounds = (roundsCount: number, playersCount: number): number =>
  roundsCount * playersCount;

export const createInitialRoomState = (params: {
  roomId: string;
  ownerPlayerId: string;
  ownerNickname: string;
  settingsOverride?: ClientToServerEventPayloads['create_room']['settingsOverride'];
}): RoomState => {
  const nowIso = new Date().toISOString();
  const settings: RoomSettings = {
    maxPlayers: params.settingsOverride?.maxPlayers ?? DEFAULT_ROOM_MAX_PLAYERS,
    roundTimeSec:
      (params.settingsOverride?.roundTimeSec as RoomSettings['roundTimeSec'] | undefined) ??
      DEFAULT_ROUND_TIME_SEC,
    roundsCount: params.settingsOverride?.roundsCount ?? DEFAULT_ROUNDS_COUNT,
    wordChoicesCount: DEFAULT_WORD_CHOICES,
    hintsCount: params.settingsOverride?.hintsCount ?? DEFAULT_HINTS_COUNT,
    language: 'ru',
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
  };
};

export const saveRoomState = async (redis: RedisClientType, state: RoomState): Promise<void> => {
  const key = roomKey(state.roomId);
  await redis.set(key, JSON.stringify(state));
};

export const getRoomState = async (
  redis: RedisClientType,
  roomId: string,
): Promise<RoomState | null> => {
  const key = roomKey(roomId);
  const json = await redis.get(key);

  if (!json) {
    return null;
  }

  return JSON.parse(json) as RoomState;
};

export const deleteRoomState = async (redis: RedisClientType, roomId: string): Promise<void> => {
  const key = roomKey(roomId);
  await redis.del(key);
};
