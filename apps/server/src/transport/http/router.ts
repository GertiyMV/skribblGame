import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { HttpErrorCode, HttpErrorResponse } from '@skribbl/shared';

export type HttpMethod = 'GET' | 'POST';

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  body: unknown;
};

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

type Route = {
  method: HttpMethod;
  segments: RouteSegment[];
  handler: RouteHandler;
};

type RouteSegment = { kind: 'literal'; value: string } | { kind: 'param'; name: string };

const parseSegments = (path: string): RouteSegment[] =>
  path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.startsWith(':')
        ? { kind: 'param', name: segment.slice(1) }
        : { kind: 'literal', value: segment },
    );

const matchSegments = (
  routeSegments: RouteSegment[],
  pathSegments: string[],
): Record<string, string> | null => {
  if (routeSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index];
    const pathSegment = pathSegments[index];
    if (!routeSegment || pathSegment === undefined) {
      return null;
    }

    if (routeSegment.kind === 'literal') {
      if (routeSegment.value !== pathSegment) {
        return null;
      }
    } else {
      params[routeSegment.name] = decodeURIComponent(pathSegment);
    }
  }

  return params;
};

export class Router {
  private readonly routes: Route[] = [];

  on(method: HttpMethod, path: string, handler: RouteHandler): void {
    this.routes.push({ method, segments: parseSegments(path), handler });
  }

  match(
    method: string | undefined,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    const pathSegments = pathname.split('/').filter((segment) => segment.length > 0);

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const params = matchSegments(route.segments, pathSegments);
      if (params) {
        return { handler: route.handler, params };
      }
    }

    return null;
  }
}

export const sendJson = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

export const sendError = (
  res: ServerResponse,
  statusCode: number,
  code: HttpErrorCode,
  message: string,
): void => {
  const body: HttpErrorResponse = { error: { code, message } };
  sendJson(res, statusCode, body);
};

export const readJsonBody = async (
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: 'too_large' | 'invalid_json' }> => {
  return new Promise((resolve) => {
    let total = 0;
    const chunks: Buffer[] = [];
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        resolve({ ok: false, reason: 'too_large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) {
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (raw.length === 0) {
        resolve({ ok: true, value: {} });
        return;
      }
      try {
        resolve({ ok: true, value: JSON.parse(raw) as unknown });
      } catch {
        resolve({ ok: false, reason: 'invalid_json' });
      }
    });

    req.on('error', () => {
      if (!aborted) {
        aborted = true;
        resolve({ ok: false, reason: 'invalid_json' });
      }
    });
  });
};
