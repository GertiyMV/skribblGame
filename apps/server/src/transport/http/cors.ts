import type { IncomingMessage, ServerResponse } from 'node:http';

export const applyCorsHeaders = (res: ServerResponse, origin: string): void => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
};

export const isPreflight = (req: IncomingMessage): boolean => req.method === 'OPTIONS';

export const respondPreflight = (res: ServerResponse, origin: string): void => {
  applyCorsHeaders(res, origin);
  res.statusCode = 204;
  res.end();
};
