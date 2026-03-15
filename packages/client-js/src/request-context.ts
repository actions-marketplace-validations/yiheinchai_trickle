/**
 * Request context — propagates a request ID through async call chains.
 *
 * Uses Node.js AsyncLocalStorage so that all functions, queries, and logs
 * within a single HTTP request share the same requestId, enabling
 * per-request tracing (like Jaeger but with trickle's richer data).
 *
 * Usage:
 *   import { withRequestContext, getRequestId } from './request-context';
 *   // In Express middleware:
 *   app.use((req, res, next) => withRequestContext(req, next));
 *   // Anywhere in the call chain:
 *   const id = getRequestId(); // returns the current request's ID
 */

let als: any = null;
let counter = 0;

try {
  const { AsyncLocalStorage } = require('async_hooks');
  als = new AsyncLocalStorage();
} catch {
  // AsyncLocalStorage not available (older Node versions)
}

export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  startTime: number;
}

/**
 * Run a callback within a request context.
 */
export function withRequestContext(req: any, callback: () => void): void {
  if (!als) { callback(); return; }

  const ctx: RequestContext = {
    requestId: `req-${++counter}-${Date.now().toString(36)}`,
    method: req?.method,
    path: req?.path || req?.url,
    startTime: Date.now(),
  };

  als.run(ctx, callback);
}

/**
 * Get the current request ID (if inside a request context).
 */
export function getRequestId(): string | undefined {
  if (!als) return undefined;
  const ctx = als.getStore() as RequestContext | undefined;
  return ctx?.requestId;
}

/**
 * Get the full request context.
 */
export function getRequestContext(): RequestContext | undefined {
  if (!als) return undefined;
  return als.getStore() as RequestContext | undefined;
}
