import type { IncomingMessage } from 'node:http';

import { TokenBucket } from './rate-limiter.js';

export const extractIp = (req: IncomingMessage, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress ?? 'unknown';
};

export class HttpRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  readonly retryAfterSeconds: number;

  constructor(
    private readonly limitPerMinute: number,
    private readonly getNow: () => number = () => Date.now(),
  ) {
    this.retryAfterSeconds = Math.ceil(60 / limitPerMinute);
  }

  consume(ip: string): boolean {
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = new TokenBucket(this.limitPerMinute / 60, this.limitPerMinute, this.getNow);
      this.buckets.set(ip, bucket);
    }
    return bucket.consume();
  }
}
