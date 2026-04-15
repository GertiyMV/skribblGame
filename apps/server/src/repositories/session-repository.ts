import type { RedisClientType } from 'redis';

import { RECONNECT_TIMEOUT_MS } from '@skribbl/shared';

import type { PlayerSession, SessionId } from '../types/types-session.js';

const reconnectTtlSeconds = Math.ceil(RECONNECT_TIMEOUT_MS / 1000);

const sessionKey = (sessionId: SessionId): string => `skribbl:session:${sessionId}`;

export const saveSession = async (
  redis: RedisClientType,
  session: PlayerSession,
): Promise<void> => {
  const key = sessionKey(session.sessionId);

  await redis.hSet(key, {
    roomId: session.roomId,
    playerId: session.playerId,
    nickname: session.nickname,
  });
};

export const getSession = async (
  redis: RedisClientType,
  sessionId: SessionId,
): Promise<PlayerSession | null> => {
  const key = sessionKey(sessionId);
  const data = await redis.hGetAll(key);

  if (!data.roomId || !data.playerId || !data.nickname) {
    return null;
  }

  return {
    sessionId,
    roomId: data.roomId,
    playerId: data.playerId,
    nickname: data.nickname,
  };
};

export const deleteSession = async (
  redis: RedisClientType,
  sessionId: SessionId,
): Promise<void> => {
  const key = sessionKey(sessionId);
  await redis.del(key);
};

export const setSessionExpiry = async (
  redis: RedisClientType,
  sessionId: SessionId,
): Promise<void> => {
  await redis.expire(sessionKey(sessionId), reconnectTtlSeconds);
};

export const replaceSession = async (
  redis: RedisClientType,
  previousSessionId: SessionId,
  nextSession: PlayerSession,
): Promise<void> => {
  const nextKey = sessionKey(nextSession.sessionId);
  const multi = redis.multi();

  multi.hSet(nextKey, {
    roomId: nextSession.roomId,
    playerId: nextSession.playerId,
    nickname: nextSession.nickname,
  });

  if (previousSessionId !== nextSession.sessionId) {
    multi.del(sessionKey(previousSessionId));
  }

  await multi.exec();
};
