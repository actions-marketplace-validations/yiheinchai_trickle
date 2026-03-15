/**
 * Call trace recorder — captures function call/return events with timing
 * and parent-child relationships for building call graphs.
 *
 * Written to .trickle/calltrace.jsonl as:
 *   { "kind": "call", "function": "createUser", "module": "api",
 *     "parentId": 0, "callId": 1, "timestamp": 1710516000,
 *     "durationMs": 2.5, "args": ["Alice"], "result": {...} }
 */

import * as fs from 'fs';
import * as path from 'path';

interface CallEvent {
  kind: 'call';
  function: string;
  module: string;
  callId: number;
  parentId: number;
  depth: number;
  timestamp: number;
  durationMs: number;
  error?: string;
  requestId?: string;
}

let traceFile: string | null = null;
let callCounter = 0;
let currentCallId = 0; // 0 = top level
const callStack: number[] = [0];
const MAX_TRACE_EVENTS = 500;
let eventCount = 0;

function getTraceFile(): string {
  if (traceFile) return traceFile;
  const dir = process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  traceFile = path.join(dir, 'calltrace.jsonl');
  try { fs.writeFileSync(traceFile, ''); } catch {}
  return traceFile;
}

function writeEvent(event: CallEvent): void {
  if (eventCount >= MAX_TRACE_EVENTS) return;
  eventCount++;
  try {
    fs.appendFileSync(getTraceFile(), JSON.stringify(event) + '\n');
  } catch {}
}

/**
 * Record a function call event. Returns the callId for pairing with traceReturn.
 */
export function traceCall(functionName: string, moduleName: string): number {
  const id = ++callCounter;
  const parentId = callStack[callStack.length - 1] || 0;
  callStack.push(id);
  // We record a placeholder — duration is filled in by traceReturn
  return id;
}

/**
 * Record a function return event with timing.
 */
export function traceReturn(
  callId: number,
  functionName: string,
  moduleName: string,
  durationMs: number,
  error?: string,
): void {
  const parentId = callStack.length >= 2 ? callStack[callStack.length - 2] : 0;
  const depth = callStack.length - 1;

  // Get request ID from async context (if inside an Express request)
  let requestId: string | undefined;
  try {
    const { getRequestId } = require('./request-context');
    requestId = getRequestId();
  } catch {}

  writeEvent({
    kind: 'call',
    function: functionName,
    module: moduleName,
    callId,
    parentId,
    depth,
    timestamp: Date.now(),
    durationMs: Math.round(durationMs * 100) / 100,
    ...(error ? { error } : {}),
    ...(requestId ? { requestId } : {}),
  });

  // Pop from stack
  if (callStack[callStack.length - 1] === callId) {
    callStack.pop();
  }
}

export function initCallTrace(): void {
  // Ensure trace file is initialized
  getTraceFile();
}
