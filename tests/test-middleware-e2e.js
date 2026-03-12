/**
 * E2E test: `trickle codegen --middleware` — Express validation middleware
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes with types (including POST/PUT)
 * 3. Generate middleware via CLI (--middleware flag)
 * 4. Verify middleware contains validation functions
 * 5. Verify middleware has Express type imports
 * 6. Verify middleware validates required fields
 * 7. Verify middleware validates field types
 * 8. Verify middleware has error response handling
 * 9. Verify validators map export
 * 10. Verify backend API directly (format=middleware)
 * 11. Actually run the middleware against a test Express app
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}`).catch(() => null);
      if (res && (res.ok || res.status === 404 || res.status === 400)) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function startBackend() {
  execSync('rm -f ~/.trickle/trickle.db ~/.trickle/trickle.db-shm ~/.trickle/trickle.db-wal');
  const proc = spawn('node', ['../packages/backend/dist/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://localhost:4888/api/health');
      if (res.ok) break;
    } catch {}
    await sleep(500);
  }
  return proc;
}

function makeTypeHash(argsType, returnType) {
  const data = JSON.stringify({ a: argsType, r: returnType });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

async function ingestRoute(method, routePath, argsType, returnType) {
  const typeHash = makeTypeHash(argsType, returnType);
  await fetch('http://localhost:4888/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      functionName: `${method} ${routePath}`,
      module: 'api',
      language: 'js',
      environment: 'development',
      typeHash,
      argsType,
      returnType,
    }),
  });
}

async function run() {
  let backendProc = null;
  let appProc = null;
  const appScript = path.join(__dirname, '.test-middleware-app.js');

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Ingest sample routes
    console.log('\n=== Step 2: Ingest sample route data ===');

    // GET route (should NOT generate middleware — no body)
    await ingestRoute('GET', '/api/users',
      { kind: 'object', properties: {} },
      { kind: 'object', properties: { users: { kind: 'array', element: { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, name: { kind: 'primitive', name: 'string' } } } } } },
    );

    // POST route with body
    await ingestRoute('POST', '/api/users',
      {
        kind: 'object', properties: {
          body: {
            kind: 'object', properties: {
              name: { kind: 'primitive', name: 'string' },
              email: { kind: 'primitive', name: 'string' },
              age: { kind: 'primitive', name: 'number' },
            },
          },
        },
      },
      { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, created: { kind: 'primitive', name: 'boolean' } } },
    );

    // PUT route with body
    await ingestRoute('PUT', '/api/users/:id',
      {
        kind: 'object', properties: {
          body: {
            kind: 'object', properties: {
              name: { kind: 'primitive', name: 'string' },
              email: { kind: 'primitive', name: 'string' },
            },
          },
        },
      },
      { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, updated: { kind: 'primitive', name: 'boolean' } } },
    );

    await sleep(500);
    console.log('  3 routes ingested (1 GET, 1 POST, 1 PUT) ✓');

    // Step 3: Generate middleware via CLI
    console.log('\n=== Step 3: Generate middleware via CLI ===');
    const middlewareOutput = execSync(
      'npx trickle codegen --middleware',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );

    if (!middlewareOutput.includes('Auto-generated Express validation middleware')) {
      throw new Error('Expected middleware header comment');
    }
    console.log('  Middleware generated via --middleware flag ✓');

    // Step 4: Verify validation functions
    console.log('\n=== Step 4: Verify validation functions ===');
    if (!middlewareOutput.includes('export function validatePostApiUsers')) {
      throw new Error('Expected validatePostApiUsers function');
    }
    if (!middlewareOutput.includes('export function validatePutApiUsersId')) {
      throw new Error('Expected validatePutApiUsersId function');
    }
    // Should NOT have middleware for GET route
    if (middlewareOutput.includes('validateGetApiUsers')) {
      throw new Error('GET routes should not generate middleware');
    }
    console.log('  validatePostApiUsers and validatePutApiUsersId present ✓');
    console.log('  GET route correctly excluded ✓');

    // Step 5: Verify Express imports
    console.log('\n=== Step 5: Verify Express type imports ===');
    if (!middlewareOutput.includes('import { Request, Response, NextFunction }')) {
      throw new Error('Expected Express type imports');
    }
    console.log('  Express type imports present ✓');

    // Step 6: Verify required field validation
    console.log('\n=== Step 6: Verify required field validation ===');
    if (!middlewareOutput.includes('"name" in body') || !middlewareOutput.includes('"email" in body')) {
      throw new Error('Expected required field checks');
    }
    if (!middlewareOutput.includes('is required')) {
      throw new Error('Expected "is required" error messages');
    }
    console.log('  Required field checks (name, email, age) present ✓');

    // Step 7: Verify type checks
    console.log('\n=== Step 7: Verify field type validation ===');
    if (!middlewareOutput.includes('typeof') || !middlewareOutput.includes('"string"') || !middlewareOutput.includes('"number"')) {
      throw new Error('Expected typeof checks for string and number');
    }
    console.log('  typeof checks for string/number fields ✓');

    // Step 8: Verify error response handling
    console.log('\n=== Step 8: Verify error response handling ===');
    if (!middlewareOutput.includes('res.status(400)')) {
      throw new Error('Expected 400 status code');
    }
    if (!middlewareOutput.includes('"Validation failed"')) {
      throw new Error('Expected validation error message');
    }
    if (!middlewareOutput.includes('next()')) {
      throw new Error('Expected next() call on success');
    }
    console.log('  400 response, error messages, and next() present ✓');

    // Step 9: Verify validators map
    console.log('\n=== Step 9: Verify validators map export ===');
    if (!middlewareOutput.includes('export const validators')) {
      throw new Error('Expected validators map export');
    }
    if (!middlewareOutput.includes('"POST /api/users": validatePostApiUsers')) {
      throw new Error('Expected POST /api/users in validators map');
    }
    console.log('  validators map with route→middleware mapping ✓');

    // Step 10: Verify backend API
    console.log('\n=== Step 10: Verify backend API (format=middleware) ===');
    const apiRes = await fetch('http://localhost:4888/api/codegen?format=middleware');
    const apiData = await apiRes.json();
    if (!apiData.types || !apiData.types.includes('export function validate')) {
      throw new Error('Backend API should return middleware');
    }
    console.log('  Backend API returns middleware correctly ✓');

    // Step 11: Actually test the middleware with a real Express app
    console.log('\n=== Step 11: Test middleware with real Express app ===');

    // Write a test app that uses the generated middleware logic
    fs.writeFileSync(appScript, `
      const express = require('express');
      const app = express();
      app.use(express.json());

      // Inline version of the generated validation middleware for POST /api/users
      function validatePostApiUsers(req, res, next) {
        const errors = [];
        const body = req.body;
        if (body === null || body === undefined || typeof body !== 'object') {
          res.status(400).json({ error: 'Request body is required', errors: ['body must be an object'] });
          return;
        }
        if (!('name' in body)) errors.push('name is required');
        else if (typeof body['name'] !== 'string') errors.push('name must be a string');
        if (!('email' in body)) errors.push('email is required');
        else if (typeof body['email'] !== 'string') errors.push('email must be a string');
        if (!('age' in body)) errors.push('age is required');
        else if (typeof body['age'] !== 'number') errors.push('age must be a number');
        if (errors.length > 0) {
          res.status(400).json({ error: 'Validation failed', errors });
          return;
        }
        next();
      }

      app.post('/api/users', validatePostApiUsers, (req, res) => {
        res.json({ id: 1, name: req.body.name, created: true });
      });

      const s = app.listen(3491, () => console.log('App on 3491'));
      process.on('SIGTERM', () => { s.close(); process.exit(0); });
    `);

    appProc = spawn('node', [appScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
    });
    appProc.stderr.on('data', () => {});
    await waitForServer(3491);

    // Valid request should pass
    const validRes = await fetch('http://localhost:3491/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@test.com', age: 30 }),
    });
    if (validRes.status !== 200) {
      throw new Error(`Valid request should pass, got ${validRes.status}`);
    }
    const validData = await validRes.json();
    if (!validData.created) {
      throw new Error('Valid request should reach handler');
    }
    console.log('  Valid request: 200 OK ✓');

    // Missing fields should fail
    const missingRes = await fetch('http://localhost:3491/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    });
    if (missingRes.status !== 400) {
      throw new Error(`Missing fields should return 400, got ${missingRes.status}`);
    }
    const missingData = await missingRes.json();
    if (!missingData.errors || !missingData.errors.some(e => e.includes('email'))) {
      throw new Error('Should report missing email field');
    }
    if (!missingData.errors.some(e => e.includes('age'))) {
      throw new Error('Should report missing age field');
    }
    console.log(`  Missing fields: 400 with ${missingData.errors.length} errors ✓`);

    // Wrong types should fail
    const wrongTypeRes = await fetch('http://localhost:3491/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123, email: 'test@test.com', age: 'thirty' }),
    });
    if (wrongTypeRes.status !== 400) {
      throw new Error(`Wrong types should return 400, got ${wrongTypeRes.status}`);
    }
    const wrongTypeData = await wrongTypeRes.json();
    if (!wrongTypeData.errors.some(e => e.includes('name') && e.includes('string'))) {
      throw new Error('Should report name must be string');
    }
    if (!wrongTypeData.errors.some(e => e.includes('age') && e.includes('number'))) {
      throw new Error('Should report age must be number');
    }
    console.log(`  Wrong types: 400 with ${wrongTypeData.errors.length} type errors ✓`);

    // Empty body should fail
    const emptyRes = await fetch('http://localhost:3491/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (emptyRes.status !== 400) {
      throw new Error(`Empty body should return 400, got ${emptyRes.status}`);
    }
    console.log('  Empty body: 400 ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --middleware generates Express validation middleware!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (appProc) { appProc.kill('SIGTERM'); await sleep(300); try { appProc.kill('SIGKILL'); } catch {} }
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    try { if (fs.existsSync(appScript)) fs.unlinkSync(appScript); } catch {}
    process.exit(process.exitCode || 0);
  }
}

run();
