import { setTimeout } from 'node:timers';

import type { RedisClientType } from 'redis';

import type { HealthDegradedResponse, HealthOkResponse } from '@skribbl/shared';

import type { RouteHandler } from '../router.js';
import { sendJson } from '../router.js';

const REDIS_PING_TIMEOUT_MS = 1_000;

const pingRedis = async (redis: RedisClientType): Promise<boolean> => {
  try {
    const pong = await Promise.race<string | null>([
      redis.ping(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), REDIS_PING_TIMEOUT_MS).unref();
      }),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
};

// TODO: добавить проверку PostgreSQL (SELECT 1) в /health при подключении PG-клиента.
// См. docs/code-style/logging-and-observability.md §3 — health должен проверять Redis PING и PG SELECT 1,
// отдавать 503 при любой из деградаций.
export const createHealthHandler = (deps: { redis: RedisClientType }): RouteHandler => {
  return async ({ res }) => {
    const redisAlive = await pingRedis(deps.redis);

    if (!redisAlive) {
      const body: HealthDegradedResponse = { status: 'degraded', redis: 'down' };
      sendJson(res, 503, body);
      return;
    }

    const body: HealthOkResponse = { status: 'ok' };
    sendJson(res, 200, body);
  };
};
