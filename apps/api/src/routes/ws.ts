import { Elysia } from 'elysia';
import type { AppDeps } from '../deps';
import { isOriginAllowed } from '../http';
import type { HubSocket } from '../ws/hub';

export function wsRoute(deps: AppDeps) {
  return new Elysia({ name: 'routes.ws' }).ws('/ws', {
    beforeHandle: ({ request, set }) => {
      if (!isOriginAllowed(deps.config, request)) {
        set.status = 403;
        return 'origin forbidden';
      }
    },
    open: (ws) => deps.hub.onOpen(ws as unknown as HubSocket),
    message: (ws, message) => deps.hub.onMessage(ws as unknown as HubSocket, message),
    close: (ws) => deps.hub.onClose(ws as unknown as HubSocket),
  });
}
