type LogFn = (obj: Record<string, unknown>, msg?: string) => void;

export type Logger = {
  info: LogFn;
  error: LogFn;
  child(bindings: Record<string, unknown>): Logger;
};

export const noopLogger: Logger = {
  info: () => {},
  error: () => {},
  child: () => noopLogger,
};

export async function createLogger(): Promise<Logger> {
  const { env } = await import('./config/env.js');

  if (env.NODE_ENV === 'production' || !env.LOG_REQUESTS) {
    return noopLogger;
  }

  const { default: pino } = await import('pino');
  const instance = pino({ level: env.LOG_LEVEL });

  const wrap = (p: typeof instance): Logger => ({
    info: (obj, msg) => p.info(obj, msg ?? ''),
    error: (obj, msg) => p.error(obj, msg ?? ''),
    child: (bindings) => wrap(p.child(bindings)),
  });

  return wrap(instance);
}
