/**
 * Zero-code auto-instrumentation for Node.js applications.
 *
 * Usage — just add a flag to your start command:
 *
 *   node -r trickle/register app.js
 *
 * Or with environment variables:
 *
 *   TRICKLE_BACKEND_URL=http://localhost:4888 node -r trickle/register app.js
 *
 * This module patches Node's module loader to intercept framework requires
 * (Express, Fastify, Koa, Hono) and automatically instrument any app created.
 *
 * Supported environment variables:
 *   TRICKLE_BACKEND_URL  — Backend URL (default: http://localhost:4888)
 *   TRICKLE_ENABLED      — Set to "0" or "false" to disable (default: enabled)
 *   TRICKLE_DEBUG        — Set to "1" or "true" for debug logging
 *   TRICKLE_ENV          — Override detected environment name
 */

import Module from 'module';
import { configure } from './transport';
import { instrumentExpress } from './express';
import { instrumentFastify } from './fastify';
import { instrumentKoa } from './koa';
import { instrumentHono } from './hono';
import { detectEnvironment } from './env-detect';

const M = Module as any;
const originalLoad = M._load;
const patched = new Set<string>();

// Read config from environment
const backendUrl = process.env.TRICKLE_BACKEND_URL || 'http://localhost:4888';
const enabled = process.env.TRICKLE_ENABLED !== '0' && process.env.TRICKLE_ENABLED !== 'false';
const debug = process.env.TRICKLE_DEBUG === '1' || process.env.TRICKLE_DEBUG === 'true';
const envOverride = process.env.TRICKLE_ENV || undefined;
const environment = envOverride || detectEnvironment();

if (enabled) {
  // Configure the transport
  configure({
    backendUrl,
    batchIntervalMs: 2000,
    debug,
    enabled: true,
    environment,
  });

  if (debug) {
    console.log(`[trickle] Auto-instrumentation enabled (backend: ${backendUrl})`);
  }

  // Patch Module._load to intercept framework requires
  M._load = function hookedLoad(request: string, parent: any, isMain: boolean): any {
    const exports = originalLoad.apply(this, arguments);

    // Intercept require('express')
    if (request === 'express' && !patched.has('express')) {
      patched.add('express');
      return patchExpress(exports, request, parent);
    }

    // Intercept require('fastify')
    if (request === 'fastify' && !patched.has('fastify')) {
      patched.add('fastify');
      return patchFastify(exports, request, parent);
    }

    // Intercept require('koa')
    if (request === 'koa' && !patched.has('koa')) {
      patched.add('koa');
      return patchKoa(exports, request, parent);
    }

    // Intercept require('hono')
    if (request === 'hono' && !patched.has('hono')) {
      patched.add('hono');
      return patchHono(exports, request, parent);
    }

    return exports;
  };
} else if (debug) {
  console.log('[trickle] Auto-instrumentation disabled (TRICKLE_ENABLED=false)');
}

/**
 * Wrap the Express factory function so every app created is auto-instrumented.
 */
function patchExpress(originalExpress: any, request: string, parent: any): any {
  function wrappedExpress(this: any, ...args: any[]): any {
    const app = originalExpress.apply(this, args);
    try {
      instrumentExpress(app, { environment });
      if (debug) {
        console.log('[trickle] Auto-instrumented Express app');
      }
    } catch (err: unknown) {
      if (debug) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[trickle] Failed to auto-instrument Express: ${msg}`);
      }
    }
    return app;
  }

  for (const key of Object.keys(originalExpress)) {
    (wrappedExpress as any)[key] = originalExpress[key];
  }
  Object.setPrototypeOf(wrappedExpress, Object.getPrototypeOf(originalExpress));

  try {
    const resolvedPath = M._resolveFilename(request, parent);
    if (require.cache[resolvedPath]) {
      require.cache[resolvedPath]!.exports = wrappedExpress;
    }
  } catch {}

  return wrappedExpress;
}

/**
 * Wrap the Fastify factory function.
 */
function patchFastify(origExports: any, request: string, parent: any): any {
  const factory = typeof origExports === 'function' ? origExports : origExports.default || origExports.fastify;
  if (typeof factory !== 'function') return origExports;

  const wrappedFactory = function (this: any, ...args: any[]): any {
    const app = factory.apply(this, args);
    try {
      instrumentFastify(app, { environment });
      if (debug) console.log('[trickle] Auto-instrumented Fastify app');
    } catch (err: unknown) {
      if (debug) console.warn(`[trickle] Failed to auto-instrument Fastify: ${(err as Error).message}`);
    }
    return app;
  };

  for (const key of Object.keys(factory)) {
    (wrappedFactory as any)[key] = (factory as any)[key];
  }

  if (typeof origExports === 'function') {
    try {
      const resolvedPath = M._resolveFilename(request, parent);
      if (require.cache[resolvedPath]) require.cache[resolvedPath]!.exports = wrappedFactory;
    } catch {}
    return wrappedFactory;
  }

  const wrapped = { ...origExports };
  if (origExports.default) wrapped.default = wrappedFactory;
  if (origExports.fastify) wrapped.fastify = wrappedFactory;
  return wrapped;
}

/**
 * Wrap the Koa constructor.
 */
function patchKoa(origExports: any, request: string, parent: any): any {
  const KoaClass = typeof origExports === 'function' ? origExports : origExports.default;
  if (typeof KoaClass !== 'function') return origExports;

  const WrappedKoa = function (this: any, ...args: any[]): any {
    const app = new KoaClass(...args);
    try {
      instrumentKoa(app, { environment });
      if (debug) console.log('[trickle] Auto-instrumented Koa app');
    } catch (err: unknown) {
      if (debug) console.warn(`[trickle] Failed to auto-instrument Koa: ${(err as Error).message}`);
    }
    return app;
  };
  WrappedKoa.prototype = KoaClass.prototype;
  for (const key of Object.keys(KoaClass)) {
    (WrappedKoa as any)[key] = (KoaClass as any)[key];
  }

  if (typeof origExports === 'function') {
    try {
      const resolvedPath = M._resolveFilename(request, parent);
      if (require.cache[resolvedPath]) require.cache[resolvedPath]!.exports = WrappedKoa;
    } catch {}
    return WrappedKoa;
  }
  return { ...origExports, default: WrappedKoa };
}

/**
 * Wrap the Hono constructor.
 */
function patchHono(origExports: any, request: string, parent: any): any {
  const HonoClass = origExports.Hono || (origExports.default && origExports.default.Hono);
  if (typeof HonoClass !== 'function') return origExports;

  const WrappedHono = function (this: any, ...args: any[]): any {
    const app = new HonoClass(...args);
    try {
      instrumentHono(app, { environment });
      if (debug) console.log('[trickle] Auto-instrumented Hono app');
    } catch (err: unknown) {
      if (debug) console.warn(`[trickle] Failed to auto-instrument Hono: ${(err as Error).message}`);
    }
    return app;
  };
  WrappedHono.prototype = HonoClass.prototype;
  for (const key of Object.keys(HonoClass)) {
    (WrappedHono as any)[key] = (HonoClass as any)[key];
  }

  const result = { ...origExports, Hono: WrappedHono };

  try {
    const resolvedPath = M._resolveFilename(request, parent);
    if (require.cache[resolvedPath]) {
      const cached = require.cache[resolvedPath]!.exports;
      if (cached.Hono) cached.Hono = WrappedHono;
    }
  } catch {}

  return result;
}
