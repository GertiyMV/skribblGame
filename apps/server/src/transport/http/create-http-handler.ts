import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

import type { HttpHandlerDeps } from '../../types/types-http.js';
import { applyCorsHeaders, isPreflight, respondPreflight } from './cors.js';
import { createHealthHandler } from './handlers/health.js';
import { createGetRoomHandler, createPostRoomHandler } from './handlers/rooms.js';
import { Router, readJsonBody, sendError } from './router.js';

const HTTP_MAX_BODY_BYTES = 16 * 1024;

export type HttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export const createHttpHandler = (deps: HttpHandlerDeps): HttpRequestHandler => {
  const router = new Router();
  router.on('GET', '/health', createHealthHandler({ redis: deps.redis }));
  router.on(
    'POST',
    '/rooms',
    createPostRoomHandler({
      redis: deps.redis,
      roomManager: deps.roomManager,
      rateLimiter: deps.rateLimiter,
      trustProxy: deps.trustProxy,
    }),
  );
  router.on('GET', '/rooms/:code', createGetRoomHandler({ redis: deps.redis }));

  return async (req, res) => {
    try {
      if (isPreflight(req)) {
        respondPreflight(res, deps.clientOrigin);
        return;
      }

      applyCorsHeaders(res, deps.clientOrigin);

      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = router.match(req.method, url.pathname);

      if (!match) {
        sendError(res, 404, 'invalid_payload', 'Not found');
        return;
      }

      let body: unknown = undefined;
      if (req.method === 'POST') {
        const bodyResult = await readJsonBody(req, HTTP_MAX_BODY_BYTES);
        if (!bodyResult.ok) {
          if (bodyResult.reason === 'too_large') {
            sendError(res, 413, 'invalid_payload', 'Request body too large');
          } else {
            sendError(res, 400, 'invalid_payload', 'Invalid JSON body');
          }
          return;
        }
        body = bodyResult.value;
      }

      await match.handler({ req, res, params: match.params, body });
    } catch (error) {
      console.error('HTTP handler error', error);
      if (!res.headersSent) {
        sendError(res, 500, 'internal_error', 'Internal server error');
      } else {
        res.end();
      }
    }
  };
};
