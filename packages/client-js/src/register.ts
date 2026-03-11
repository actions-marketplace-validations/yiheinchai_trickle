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
 * This module patches Node's module loader to intercept `require('express')`
 * and automatically instrument any Express app created — no code changes needed.
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
import { detectEnvironment } from './env-detect';

const M = Module as any;
const originalLoad = M._load;
const patched = new Set<string>();

// Read config from environment
const backendUrl = process.env.TRICKLE_BACKEND_URL || 'http://localhost:4888';
const enabled = process.env.TRICKLE_ENABLED !== '0' && process.env.TRICKLE_ENABLED !== 'false';
const debug = process.env.TRICKLE_DEBUG === '1' || process.env.TRICKLE_DEBUG === 'true';
const envOverride = process.env.TRICKLE_ENV || undefined;

if (enabled) {
  // Configure the transport
  configure({
    backendUrl,
    batchIntervalMs: 2000,
    debug,
    enabled: true,
    environment: envOverride || detectEnvironment(),
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

    return exports;
  };
} else if (debug) {
  console.log('[trickle] Auto-instrumentation disabled (TRICKLE_ENABLED=false)');
}

/**
 * Wrap the Express factory function so every app created is auto-instrumented.
 * Preserves all static properties (express.json, express.static, etc.).
 */
function patchExpress(originalExpress: any, request: string, parent: any): any {
  function wrappedExpress(this: any, ...args: any[]): any {
    const app = originalExpress.apply(this, args);
    try {
      instrumentExpress(app, {
        environment: envOverride || detectEnvironment(),
      });
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

  // Copy all static properties (express.json, express.static, express.Router, etc.)
  for (const key of Object.keys(originalExpress)) {
    (wrappedExpress as any)[key] = originalExpress[key];
  }

  // Preserve prototype chain
  Object.setPrototypeOf(wrappedExpress, Object.getPrototypeOf(originalExpress));

  // Update require cache so subsequent require('express') returns the patched version
  try {
    const resolvedPath = M._resolveFilename(request, parent);
    if (require.cache[resolvedPath]) {
      require.cache[resolvedPath]!.exports = wrappedExpress;
    }
  } catch {
    // Cache update failed — first require still returns patched, but subsequent
    // requires from other modules may get the original. This is rare.
  }

  return wrappedExpress;
}
