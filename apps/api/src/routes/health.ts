import { Elysia } from 'elysia';

export function healthRoutes() {
  return new Elysia({ name: 'routes.health' }).get('/health', () => ({ status: 'ok' }));
}
