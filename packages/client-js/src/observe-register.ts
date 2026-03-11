/**
 * Auto-observation register — patches Node's module loader to automatically
 * wrap all exported functions from user modules.
 *
 * Usage:
 *
 *   node -r trickle/observe app.js
 *
 * Every function exported from your application code (not node_modules)
 * will be observed — types and sample data captured for every call.
 *
 * Environment variables:
 *   TRICKLE_BACKEND_URL     — Backend URL (default: http://localhost:4888)
 *   TRICKLE_ENABLED         — Set to "0" or "false" to disable
 *   TRICKLE_DEBUG           — Set to "1" for debug logging
 *   TRICKLE_ENV             — Override detected environment
 *   TRICKLE_OBSERVE_INCLUDE — Comma-separated substrings to include (default: all user code)
 *   TRICKLE_OBSERVE_EXCLUDE — Comma-separated substrings to exclude (default: none)
 */

import Module from 'module';
import path from 'path';
import { configure } from './transport';
import { detectEnvironment } from './env-detect';
import { wrapFunction } from './wrap';
import { WrapOptions } from './types';

const M = Module as any;
const originalLoad = M._load;

// Read config from environment
const backendUrl = process.env.TRICKLE_BACKEND_URL || 'http://localhost:4888';
const enabled = process.env.TRICKLE_ENABLED !== '0' && process.env.TRICKLE_ENABLED !== 'false';
const debug = process.env.TRICKLE_DEBUG === '1' || process.env.TRICKLE_DEBUG === 'true';
const envOverride = process.env.TRICKLE_ENV || undefined;

const includePatterns = process.env.TRICKLE_OBSERVE_INCLUDE
  ? process.env.TRICKLE_OBSERVE_INCLUDE.split(',').map(s => s.trim())
  : [];
const excludePatterns = process.env.TRICKLE_OBSERVE_EXCLUDE
  ? process.env.TRICKLE_OBSERVE_EXCLUDE.split(',').map(s => s.trim())
  : [];

const wrapped = new Set<string>();

if (enabled) {
  const environment = envOverride || detectEnvironment();

  configure({
    backendUrl,
    batchIntervalMs: 2000,
    debug,
    enabled: true,
    environment,
  });

  if (debug) {
    console.log(`[trickle/observe] Auto-observation enabled (backend: ${backendUrl})`);
  }

  M._load = function hookedLoad(request: string, parent: any, isMain: boolean): any {
    const exports = originalLoad.apply(this, arguments);

    // Only process user modules (relative paths)
    if (!request.startsWith('.') && !request.startsWith('/')) {
      return exports;
    }

    // Resolve to absolute path for dedup
    let resolvedPath: string;
    try {
      resolvedPath = M._resolveFilename(request, parent);
    } catch {
      return exports;
    }

    // Skip node_modules
    if (resolvedPath.includes('node_modules')) return exports;

    // Skip already-wrapped modules
    if (wrapped.has(resolvedPath)) return exports;

    // Apply include/exclude filters
    if (includePatterns.length > 0) {
      const matches = includePatterns.some(p => resolvedPath.includes(p));
      if (!matches) return exports;
    }
    if (excludePatterns.length > 0) {
      const excluded = excludePatterns.some(p => resolvedPath.includes(p));
      if (excluded) return exports;
    }

    wrapped.add(resolvedPath);

    // Derive module name from file path
    const moduleName = path.basename(resolvedPath).replace(/\.[jt]sx?$/, '');

    // Wrap exported functions
    if (exports && typeof exports === 'object') {
      let count = 0;
      for (const key of Object.keys(exports)) {
        if (typeof exports[key] === 'function' && key !== 'default') {
          const fn = exports[key];
          const wrapOpts: WrapOptions = {
            functionName: key,
            module: moduleName,
            trackArgs: true,
            trackReturn: true,
            sampleRate: 1,
            maxDepth: 5,
            environment,
            enabled: true,
          };
          exports[key] = wrapFunction(fn, wrapOpts);
          count++;
        }
      }

      // Handle default export if it's a function
      if (typeof exports.default === 'function') {
        const fn = exports.default;
        const wrapOpts: WrapOptions = {
          functionName: fn.name || 'default',
          module: moduleName,
          trackArgs: true,
          trackReturn: true,
          sampleRate: 1,
          maxDepth: 5,
          environment,
          enabled: true,
        };
        exports.default = wrapFunction(fn, wrapOpts);
        count++;
      }

      if (debug && count > 0) {
        console.log(`[trickle/observe] Wrapped ${count} functions from ${moduleName} (${resolvedPath})`);
      }
    } else if (typeof exports === 'function') {
      // Module exports a single function (e.g. module.exports = fn)
      const fn = exports;
      const wrapOpts: WrapOptions = {
        functionName: fn.name || moduleName,
        module: moduleName,
        trackArgs: true,
        trackReturn: true,
        sampleRate: 1,
        maxDepth: 5,
        environment,
        enabled: true,
      };
      const wrappedFn = wrapFunction(fn, wrapOpts);

      // Copy static properties
      for (const key of Object.keys(fn)) {
        (wrappedFn as any)[key] = fn[key];
      }

      // Update require cache
      try {
        if (require.cache[resolvedPath]) {
          require.cache[resolvedPath]!.exports = wrappedFn;
        }
      } catch {
        // Cache update failed — non-critical
      }

      if (debug) {
        console.log(`[trickle/observe] Wrapped default export from ${moduleName}`);
      }

      return wrappedFn;
    }

    return exports;
  };
} else if (debug) {
  console.log('[trickle/observe] Auto-observation disabled (TRICKLE_ENABLED=false)');
}
