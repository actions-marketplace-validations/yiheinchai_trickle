/**
 * Variable-level tracing — captures the runtime type and sample value
 * of variable assignments within function bodies.
 *
 * This is injected by the Module._compile source transform. After each
 * `const/let/var x = expr;` statement, the transform inserts:
 *
 *   __trickle_tv(x, 'x', 42, 'my-module', '/path/to/file.ts');
 *
 * The traceVar function:
 * 1. Infers the TypeNode from the runtime value
 * 2. Captures a sanitized sample value
 * 3. Appends to .trickle/variables.jsonl
 * 4. Caches by (file:line:varName + typeHash) to avoid duplicates
 */

import * as fs from 'fs';
import * as path from 'path';
import { TypeNode } from './types';
import { inferType } from './type-inference';
import { hashType } from './type-hash';

/** Where to write variable observations */
let varsFilePath = '';
let debugMode = false;

/** Cache: "file:line:varName" → { fingerprint, timestamp } for value-aware dedup */
const varCache = new Map<string, { fp: string; ts: number }>();
/** Per-line sample count to avoid loop variable spam */
const sampleCount = new Map<string, number>();
const MAX_SAMPLES_PER_LINE = 5;

/** Batch buffer for writing — avoids one fs.appendFileSync per variable */
let varBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER_SIZE = 100;

export interface VariableObservation {
  kind: 'variable';
  varName: string;
  line: number;
  module: string;
  file: string;
  type: TypeNode;
  typeHash: string;
  sample: unknown;
}

/**
 * Initialize the variable tracer.
 * Called once during observe-register setup.
 */
export function initVarTracer(opts: { debug?: boolean } = {}): void {
  debugMode = opts.debug === true;
  // Auto-detect Lambda: use /tmp/.trickle (writable) instead of cwd (read-only in Lambda)
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const defaultDir = isLambda ? '/tmp/.trickle' : path.join(process.cwd(), '.trickle');
  const dir = process.env.TRICKLE_LOCAL_DIR || defaultDir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  varsFilePath = path.join(dir, 'variables.jsonl');

  if (debugMode) {
    console.log(`[trickle/vars] Variable tracing enabled → ${varsFilePath}`);
  }

  // Capture console output to .trickle/console.jsonl for agent debugging
  if (process.env.TRICKLE_CAPTURE_CONSOLE !== '0') {
    patchConsole(dir);
  }
}

/** Patch console.log/error/warn to also write to console.jsonl */
function patchConsole(dir: string): void {
  const consoleFile = path.join(dir, 'console.jsonl');
  // Clear previous console log
  try { fs.writeFileSync(consoleFile, ''); } catch { return; }

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  function capture(level: string, args: unknown[]): void {
    try {
      const message = args.map(a =>
        typeof a === 'string' ? a : JSON.stringify(a)
      ).join(' ');
      // Skip trickle's own output
      if (message.startsWith('[trickle')) return;
      const record = { level, message: message.substring(0, 500), timestamp: Date.now() };
      fs.appendFileSync(consoleFile, JSON.stringify(record) + '\n');
    } catch {}
  }

  console.log = function (...args: unknown[]) {
    capture('log', args);
    return origLog.apply(console, args);
  };
  console.error = function (...args: unknown[]) {
    capture('error', args);
    return origError.apply(console, args);
  };
  console.warn = function (...args: unknown[]) {
    capture('warn', args);
    return origWarn.apply(console, args);
  };
}

/**
 * Trace a variable's runtime value.
 * Called by injected code after each variable declaration.
 *
 * @param value - The variable's current value (already computed)
 * @param varName - The variable name in source
 * @param line - Line number in source file
 * @param moduleName - Module name (derived from filename)
 * @param filePath - Absolute path to source file
 */
export function traceVar(
  value: unknown,
  varName: string,
  line: number,
  moduleName: string,
  filePath: string,
): void {
  // Auto-initialize if not yet done (needed for Vite/Vitest worker processes)
  if (!varsFilePath) {
    initVarTracer();
    if (!varsFilePath) return;
  }

  try {
    const type = inferType(value, 3);

    // Create a stable hash for dedup
    const dummyArgs: TypeNode = { kind: 'tuple', elements: [] };
    const typeHash = hashType(dummyArgs, type);

    // Per-line sample count limit: stop after N samples to avoid loop spam
    const cacheKey = `${filePath}:${line}:${varName}`;
    const cnt = sampleCount.get(cacheKey) || 0;
    if (cnt >= MAX_SAMPLES_PER_LINE) return;

    // Value-aware dedup: re-send if value changed or 10s elapsed
    const t = typeof value;
    const fp = (t === 'string' || t === 'number' || t === 'boolean' || value === null || value === undefined)
      ? String(value).substring(0, 60)
      : typeHash;
    const now = Date.now();
    const prev = varCache.get(cacheKey);
    if (prev && prev.fp === fp && (now - prev.ts) < 10000) return;
    varCache.set(cacheKey, { fp, ts: now });
    sampleCount.set(cacheKey, cnt + 1);

    const sample = sanitizeVarSample(value);

    const observation: VariableObservation = {
      kind: 'variable',
      varName,
      line,
      module: moduleName,
      file: filePath,
      type,
      typeHash,
      sample,
    };

    // Buffer the write
    varBuffer.push(JSON.stringify(observation));

    if (varBuffer.length >= MAX_BUFFER_SIZE) {
      flushVarBuffer();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushVarBuffer();
      }, FLUSH_INTERVAL_MS);
      if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
        flushTimer.unref();
      }
    }
  } catch {
    // Never crash user's app
  }
}

/**
 * Flush buffered variable observations to disk.
 */
function flushVarBuffer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (varBuffer.length === 0) return;

  const lines = varBuffer.join('\n') + '\n';
  varBuffer = [];

  try {
    fs.appendFileSync(varsFilePath, lines);
  } catch {
    // Never crash user's app
  }
}

/**
 * Sanitize a variable value for safe serialization.
 * More aggressive truncation than function samples since there are many more variables.
 */
function sanitizeVarSample(value: unknown, depth: number = 3): unknown {
  if (value === null) return null;
  // JSON.stringify drops undefined values, so use null to preserve the field
  if (value === undefined) return null;

  const t = typeof value;
  // Primitives are always safe to return at any depth
  if (t === 'string') {
    const s = value as string;
    return s.length > 60 ? s.substring(0, 60) + '...' : s;
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return String(value);
  if (t === 'symbol') return String(value);
  if (t === 'function') return `[Function: ${(value as Function).name || 'anonymous'}]`;

  if (depth <= 0) return '[...]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => sanitizeVarSample(item, depth - 1));
  }

  if (t === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (value instanceof Error) return { error: value.message };
    if (value instanceof Map) return `[Map: ${value.size} entries]`;
    if (value instanceof Set) return `[Set: ${value.size} items]`;
    if (value instanceof Promise) return '[Promise]';

    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const keys = Object.keys(obj).slice(0, 10);
    for (const key of keys) {
      try {
        result[key] = sanitizeVarSample(obj[key], depth - 1);
      } catch {
        result[key] = '[unreadable]';
      }
    }
    return result;
  }

  return String(value);
}

// Flush on process exit — use 'exit' event (synchronous, fires even on process.exit())
// because Vitest workers and forked processes may exit without 'beforeExit'.
// flushVarBuffer uses fs.appendFileSync so it's safe in the 'exit' handler.
if (typeof process !== 'undefined' && process.on) {
  const exitFlush = () => { flushVarBuffer(); };
  process.on('exit', exitFlush);
  process.on('beforeExit', exitFlush);
  process.on('SIGTERM', exitFlush);
  process.on('SIGINT', exitFlush);

  // Capture uncaught exceptions with variable context for agent debugging.
  // Write error + nearby variable values to errors.jsonl before the process exits.
  process.on('uncaughtException', (err: Error) => {
    flushVarBuffer();
    try {
      const dir = varsFilePath
        ? path.dirname(varsFilePath)
        : process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const errorsFile = path.join(dir, 'errors.jsonl');

      // Extract file and line from stack trace
      const stackLines = (err.stack || '').split('\n');
      let errorFile: string | undefined;
      let errorLine: number | undefined;
      for (const sl of stackLines.slice(1)) {
        const m = sl.match(/\((.+):(\d+):\d+\)/) || sl.match(/at (.+):(\d+):\d+/);
        if (m && !m[1].includes('node_modules') && !m[1].includes('node:') && !m[1].includes('trickle')) {
          errorFile = m[1];
          errorLine = parseInt(m[2]);
          break;
        }
      }

      // Find nearby variable values from the cache
      const nearbyVars: Record<string, string> = {};
      if (errorFile && errorLine) {
        for (const [key, entry] of varCache) {
          const parts = key.split(':');
          const file = parts[0];
          const line = parseInt(parts[1]);
          const varName = parts.slice(2).join(':');
          if (file === errorFile && Math.abs(line - errorLine) <= 10) {
            nearbyVars[`L${parts[1]} ${varName}`] = entry.fp;
          }
        }
      }

      const record = {
        kind: 'error',
        error: err.message,
        type: err.constructor.name,
        file: errorFile,
        line: errorLine,
        stack: stackLines.slice(0, 6).join('\n'),
        nearbyVariables: Object.keys(nearbyVars).length > 0 ? nearbyVars : undefined,
        timestamp: new Date().toISOString(),
      };
      fs.appendFileSync(errorsFile, JSON.stringify(record) + '\n');
    } catch {
      // Never suppress the original error
    }
    // Print the original error and exit (don't re-throw to preserve original stack)
    console.error(err.stack || err.message);
    process.exit(1);
  });
}
