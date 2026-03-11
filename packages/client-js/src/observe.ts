/**
 * Universal function observation — wrap any module's exports to capture
 * runtime types and sample data for every function call.
 *
 * Usage:
 *
 *   import { observe } from 'trickle';
 *   import * as helpers from './myHelpers';
 *
 *   const { fetchUser, createOrder } = observe(helpers, { module: 'my-helpers' });
 *   // Every call to fetchUser / createOrder now captures types + samples
 *
 * Works with any object whose values are functions — module exports, plain
 * objects, class instances, test helpers, SDK clients, etc.
 */

import { wrapFunction } from './wrap';
import { WrapOptions } from './types';
import { detectEnvironment } from './env-detect';

export interface ObserveOpts {
  /** Module name shown in `trickle functions` output. Defaults to 'observed'. */
  module?: string;
  /** Environment label. Auto-detected if omitted. */
  environment?: string;
  /** Fraction of calls to capture (0–1). Defaults to 1 (all calls). */
  sampleRate?: number;
  /** Max depth for type inference. Defaults to 5. */
  maxDepth?: number;
  /** Set to false to disable observation (passthrough). Defaults to true. */
  enabled?: boolean;
}

/**
 * Wrap every function property on `obj` so calls are observed by trickle.
 * Non-function properties are copied through unchanged.
 *
 * Returns a new object with the same shape — the original is never mutated.
 */
export function observe<T extends Record<string, any>>(obj: T, opts?: ObserveOpts): T {
  if (!obj || typeof obj !== 'object') return obj;

  const moduleName = opts?.module || inferModuleName();
  const environment = opts?.environment || detectEnvironment();
  const enabled = opts?.enabled !== false;
  const sampleRate = opts?.sampleRate ?? 1;
  const maxDepth = opts?.maxDepth ?? 5;

  const result: Record<string, any> = {};

  for (const key of Object.keys(obj)) {
    const val = obj[key];

    if (typeof val === 'function') {
      const wrapOpts: WrapOptions = {
        functionName: key,
        module: moduleName,
        trackArgs: true,
        trackReturn: true,
        sampleRate,
        maxDepth,
        environment,
        enabled,
      };
      result[key] = wrapFunction(val, wrapOpts);
    } else {
      result[key] = val;
    }
  }

  return result as T;
}

/**
 * Wrap a single function for observation.
 * Convenience for when you don't have a module object to pass to observe().
 *
 *   import { observeFn } from 'trickle';
 *   const tracedFetch = observeFn(fetchUser, { module: 'api', name: 'fetchUser' });
 */
export function observeFn<T extends (...args: any[]) => any>(
  fn: T,
  opts?: ObserveOpts & { name?: string },
): T {
  const wrapOpts: WrapOptions = {
    functionName: opts?.name || fn.name || 'anonymous',
    module: opts?.module || inferModuleName(),
    trackArgs: true,
    trackReturn: true,
    sampleRate: opts?.sampleRate ?? 1,
    maxDepth: opts?.maxDepth ?? 5,
    environment: opts?.environment || detectEnvironment(),
    enabled: opts?.enabled !== false,
  };

  return wrapFunction(fn, wrapOpts);
}

/**
 * Attempt to infer a module name from the call stack.
 */
function inferModuleName(): string {
  try {
    const stack = new Error().stack;
    if (!stack) return 'observed';

    const lines = stack.split('\n');
    // Skip internal frames (Error, observe internals)
    for (let i = 3; i < lines.length; i++) {
      const line = lines[i].trim();
      const match = line.match(/(?:at\s+)?(?:.*?\s+\()?(.+?)(?::\d+:\d+)?\)?$/);
      if (match) {
        const filePath = match[1];
        if (filePath.includes('node_modules')) continue;
        if (filePath.includes('trickle')) continue;
        const parts = filePath.split('/');
        const filename = parts[parts.length - 1];
        if (filename && !filename.startsWith('<')) {
          return filename.replace(/\.[jt]sx?$/, '');
        }
      }
    }
  } catch {
    // Don't crash on stack inspection failure
  }
  return 'observed';
}
