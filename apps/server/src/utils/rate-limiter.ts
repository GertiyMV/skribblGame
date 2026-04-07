export type RateLimitCategory = 'draw' | 'guess' | 'other';

const RATE_LIMITS: Record<RateLimitCategory, number> = {
  draw: 60,
  guess: 5,
  other: 10,
};

const EVENT_CATEGORY: Partial<Record<string, RateLimitCategory>> = {
  draw: 'draw',
  guess: 'guess',
};

export const getEventCategory = (event: string): RateLimitCategory =>
  EVENT_CATEGORY[event] ?? 'other';

export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly capacity: number = ratePerSecond,
    private readonly getNow: () => number = () => Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefillTime = getNow();
  }

  consume(): boolean {
    const now = this.getNow();
    const elapsed = (now - this.lastRefillTime) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerSecond);
    this.lastRefillTime = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }
}

export class SocketRateLimiter {
  private readonly buckets: Record<RateLimitCategory, TokenBucket>;

  constructor(getNow: () => number = () => Date.now()) {
    this.buckets = {
      draw: new TokenBucket(RATE_LIMITS.draw, RATE_LIMITS.draw, getNow),
      guess: new TokenBucket(RATE_LIMITS.guess, RATE_LIMITS.guess, getNow),
      other: new TokenBucket(RATE_LIMITS.other, RATE_LIMITS.other, getNow),
    };
  }

  consume(event: string): boolean {
    const category = getEventCategory(event);
    return this.buckets[category].consume();
  }
}
