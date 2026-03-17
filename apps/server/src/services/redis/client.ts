import { createClient, type RedisClientType } from 'redis';

import { env } from '../../config/env.js';

let client: RedisClientType | null = null;

export const getRedisClient = (): RedisClientType => {
  if (!client) {
    client = createClient({
      url: env.REDIS_URL,
    });

    client.on('error', (err) => {
      console.error('Redis client error', err);
    });
  }

  return client;
};

export const connectRedis = async (): Promise<RedisClientType> => {
  const redis = getRedisClient();

  if (!redis.isOpen) {
    await redis.connect();
  }

  return redis;
};
