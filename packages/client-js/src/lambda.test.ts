/**
 * Unit tests for wrapLambda and printObservations.
 *
 * Run with: node --experimental-strip-types --test src/lambda.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── wrapLambda ────────────────────────────────────────────────────────────────

describe('wrapLambda', () => {
  const makeContext = () => ({
    functionName: 'test-fn',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123:function:test-fn',
    awsRequestId: 'req-1',
  });

  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-lambda-test-'));
    process.env.TRICKLE_LOCAL_DIR = tmpDir;
  });

  after(() => {
    delete process.env.TRICKLE_LOCAL_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the handler result unchanged', async () => {
    // Import fresh to avoid module cache issues with env vars
    const { wrapLambda } = await import('../dist/lambda.js');
    const handler = async (_event: unknown, _ctx: unknown) => ({ statusCode: 200, body: 'ok' });
    const wrapped = wrapLambda(handler);
    const result = await wrapped({ orderId: '123' }, makeContext());
    assert.deepEqual(result, { statusCode: 200, body: 'ok' });
  });

  it('passes event and context to the handler', async () => {
    const { wrapLambda } = await import('../dist/lambda.js');
    let receivedEvent: unknown;
    let receivedCtx: unknown;
    const handler = async (event: unknown, ctx: unknown) => {
      receivedEvent = event;
      receivedCtx = ctx;
      return 'done';
    };
    const wrapped = wrapLambda(handler);
    const ctx = makeContext();
    await wrapped({ hello: 'world' }, ctx);
    assert.deepEqual(receivedEvent, { hello: 'world' });
    assert.equal((receivedCtx as typeof ctx).awsRequestId, 'req-1');
  });

  it('re-throws errors from the handler', async () => {
    const { wrapLambda } = await import('../dist/lambda.js');
    const handler = async () => { throw new Error('Lambda error'); };
    const wrapped = wrapLambda(handler);
    await assert.rejects(() => wrapped({}, makeContext()), /Lambda error/);
  });

  it('does not throw if TRICKLE_BACKEND_URL is not set', async () => {
    delete process.env.TRICKLE_BACKEND_URL;
    const { wrapLambda } = await import('../dist/lambda.js');
    const handler = async () => 42;
    const wrapped = wrapLambda(handler);
    const result = await wrapped({}, makeContext());
    assert.equal(result, 42);
  });
});

// ── printObservations ─────────────────────────────────────────────────────────

describe('printObservations', () => {
  let tmpDir: string;
  let originalDir: string | undefined;
  let logged: string[];
  let origLog: typeof console.log;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-print-test-'));
    originalDir = process.env.TRICKLE_LOCAL_DIR;
    process.env.TRICKLE_LOCAL_DIR = tmpDir;
    // Capture console.log output
    origLog = console.log;
    logged = [];
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
  });

  after(() => {
    console.log = origLog;
    if (originalDir !== undefined) {
      process.env.TRICKLE_LOCAL_DIR = originalDir;
    } else {
      delete process.env.TRICKLE_LOCAL_DIR;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints [trickle] prefixed JSON lines from variables.jsonl', async () => {
    const record = JSON.stringify({ kind: 'var', name: 'x', value: 1 });
    fs.writeFileSync(path.join(tmpDir, 'variables.jsonl'), record + '\n');

    const { printObservations } = await import('../dist/lambda.js');
    logged = [];
    printObservations();

    assert.ok(logged.some(l => l.startsWith('[trickle]')), 'should prefix with [trickle]');
    assert.ok(logged.some(l => l.includes('"kind"')), 'should include JSON content');
  });

  it('does not crash when no files exist', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-empty-'));
    const prevDir = process.env.TRICKLE_LOCAL_DIR;
    process.env.TRICKLE_LOCAL_DIR = emptyDir;
    try {
      const { printObservations } = await import('../dist/lambda.js');
      assert.doesNotThrow(() => printObservations());
    } finally {
      process.env.TRICKLE_LOCAL_DIR = prevDir;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('prints observations from both variables.jsonl and observations.jsonl', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-both-'));
    const prevDir = process.env.TRICKLE_LOCAL_DIR;
    process.env.TRICKLE_LOCAL_DIR = dir;
    try {
      fs.writeFileSync(path.join(dir, 'variables.jsonl'), JSON.stringify({ kind: 'var' }) + '\n');
      fs.writeFileSync(path.join(dir, 'observations.jsonl'), JSON.stringify({ kind: 'obs' }) + '\n');

      const { printObservations } = await import('../dist/lambda.js');
      logged = [];
      printObservations();
      const count = logged.filter(l => l.startsWith('[trickle]')).length;
      assert.ok(count >= 2, `should print at least 2 [trickle] lines, got ${count}`);
    } finally {
      process.env.TRICKLE_LOCAL_DIR = prevDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
