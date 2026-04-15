import type { Nickname, PlayerId, RoomId } from '@skribbl/shared';

export type SessionId = string;

export type PlayerSession = {
  sessionId: SessionId;
  roomId: RoomId;
  playerId: PlayerId;
  nickname: Nickname;
};
