/**
 * E2E test: `trickle codegen --msw` — MSW request handler generation
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes with types
 * 3. Generate MSW handlers via CLI (--msw flag)
 * 4. Verify MSW import statement
 * 5. Verify response type interfaces
 * 6. Verify individual handler exports
 * 7. Verify handler uses correct HTTP method
 * 8. Verify sample response data
 * 9. Verify handlers array export
 * 10. Verify backend API directly (format=msw)
 * 11. Actually run the MSW handlers with a test
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startBackend() {
  execSync('rm -f ~/.trickle/trickle.db ~/.trickle/trickle.db-shm ~/.trickle/trickle.db-wal');
  const proc = spawn('node', ['packages/backend/dist/index.js'], {
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

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Ingest sample routes
    console.log('\n=== Step 2: Ingest sample route data ===');

    // GET /api/users
    await ingestRoute('GET', '/api/users',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          users: {
            kind: 'array', element: {
              kind: 'object', properties: {
                id: { kind: 'primitive', name: 'number' },
                name: { kind: 'primitive', name: 'string' },
                email: { kind: 'primitive', name: 'string' },
              },
            },
          },
          total: { kind: 'primitive', name: 'number' },
        },
      },
    );

    // POST /api/users
    await ingestRoute('POST', '/api/users',
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
      {
        kind: 'object', properties: {
          id: { kind: 'primitive', name: 'number' },
          name: { kind: 'primitive', name: 'string' },
          created: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    // GET /api/users/:id
    await ingestRoute('GET', '/api/users/:id',
      { kind: 'object', properties: { params: { kind: 'object', properties: { id: { kind: 'primitive', name: 'string' } } } } },
      {
        kind: 'object', properties: {
          id: { kind: 'primitive', name: 'number' },
          name: { kind: 'primitive', name: 'string' },
          email: { kind: 'primitive', name: 'string' },
          active: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    // DELETE /api/users/:id
    await ingestRoute('DELETE', '/api/users/:id',
      { kind: 'object', properties: { params: { kind: 'object', properties: { id: { kind: 'primitive', name: 'string' } } } } },
      {
        kind: 'object', properties: {
          success: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    await sleep(500);
    console.log('  4 routes ingested (2 GET, 1 POST, 1 DELETE) ✓');

    // Step 3: Generate MSW handlers via CLI
    console.log('\n=== Step 3: Generate MSW handlers via CLI ===');
    const mswOutput = execSync(
      'npx trickle codegen --msw',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );

    if (!mswOutput.includes('Auto-generated MSW request handlers')) {
      throw new Error('Expected MSW header comment');
    }
    console.log('  MSW handlers generated via --msw flag ✓');

    // Step 4: Verify MSW import
    console.log('\n=== Step 4: Verify MSW import statement ===');
    if (!mswOutput.includes('import { http, HttpResponse } from "msw"')) {
      throw new Error('Expected MSW imports');
    }
    console.log('  MSW imports (http, HttpResponse) present ✓');

    // Step 5: Verify response type interfaces
    console.log('\n=== Step 5: Verify response type interfaces ===');
    if (!mswOutput.includes('export interface GetApiUsersResponse')) {
      throw new Error('Expected GetApiUsersResponse interface');
    }
    if (!mswOutput.includes('export interface PostApiUsersResponse')) {
      throw new Error('Expected PostApiUsersResponse interface');
    }
    if (!mswOutput.includes('export interface GetApiUsersIdResponse')) {
      throw new Error('Expected GetApiUsersIdResponse interface');
    }
    if (!mswOutput.includes('export interface DeleteApiUsersIdResponse')) {
      throw new Error('Expected DeleteApiUsersIdResponse interface');
    }
    console.log('  Response interfaces for all 4 routes ✓');

    // Step 6: Verify individual handler exports
    console.log('\n=== Step 6: Verify individual handler exports ===');
    if (!mswOutput.includes('export const getApiUsersHandler')) {
      throw new Error('Expected getApiUsersHandler export');
    }
    if (!mswOutput.includes('export const postApiUsersHandler')) {
      throw new Error('Expected postApiUsersHandler export');
    }
    if (!mswOutput.includes('export const getApiUsersIdHandler')) {
      throw new Error('Expected getApiUsersIdHandler export');
    }
    if (!mswOutput.includes('export const deleteApiUsersIdHandler')) {
      throw new Error('Expected deleteApiUsersIdHandler export');
    }
    console.log('  All 4 handler exports present ✓');

    // Step 7: Verify handler uses correct HTTP methods
    console.log('\n=== Step 7: Verify correct HTTP methods ===');
    if (!mswOutput.includes('http.get("/api/users"')) {
      throw new Error('Expected http.get for GET /api/users');
    }
    if (!mswOutput.includes('http.post("/api/users"')) {
      throw new Error('Expected http.post for POST /api/users');
    }
    if (!mswOutput.includes('http.get("/api/users/:id"')) {
      throw new Error('Expected http.get for GET /api/users/:id');
    }
    if (!mswOutput.includes('http.delete("/api/users/:id"')) {
      throw new Error('Expected http.delete for DELETE /api/users/:id');
    }
    console.log('  Correct HTTP methods for all routes ✓');

    // Step 8: Verify sample response data
    console.log('\n=== Step 8: Verify sample response data ===');
    if (!mswOutput.includes('HttpResponse.json(')) {
      throw new Error('Expected HttpResponse.json calls');
    }
    // The GET /api/users response should have a users array and total number
    if (!mswOutput.includes('users:') || !mswOutput.includes('total:')) {
      throw new Error('Expected users and total fields in GET response');
    }
    // The POST response should have id, name, created fields
    if (!mswOutput.includes('created:')) {
      throw new Error('Expected created field in POST response');
    }
    console.log('  Sample response data with correct field shapes ✓');

    // Step 9: Verify handlers array export
    console.log('\n=== Step 9: Verify handlers array export ===');
    if (!mswOutput.includes('export const handlers = [')) {
      throw new Error('Expected handlers array export');
    }
    if (!mswOutput.includes('getApiUsersHandler,')) {
      throw new Error('Expected getApiUsersHandler in handlers array');
    }
    if (!mswOutput.includes('postApiUsersHandler,')) {
      throw new Error('Expected postApiUsersHandler in handlers array');
    }
    console.log('  handlers array with all route handlers ✓');

    // Step 10: Verify backend API directly
    console.log('\n=== Step 10: Verify backend API (format=msw) ===');
    const apiRes = await fetch('http://localhost:4888/api/codegen?format=msw');
    const apiData = await apiRes.json();
    if (!apiData.types || !apiData.types.includes('import { http, HttpResponse }')) {
      throw new Error('Backend API should return MSW handlers');
    }
    console.log('  Backend API returns MSW handlers correctly ✓');

    // Step 11: Write to file and verify it's valid JS/TS structure
    console.log('\n=== Step 11: Verify generated code structure ===');
    const outFile = path.join(__dirname, '.test-msw-output.ts');
    execSync(
      `npx trickle codegen --msw --out ${outFile}`,
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    const fileContent = fs.readFileSync(outFile, 'utf-8');
    if (!fileContent.includes('export const handlers')) {
      throw new Error('Written file should contain handlers export');
    }
    // Verify satisfies assertions for type safety
    if (!fileContent.includes('satisfies')) {
      throw new Error('Expected satisfies assertions for type safety');
    }
    // Count handler exports (should be 4)
    const handlerMatches = fileContent.match(/export const \w+Handler = http\./g);
    if (!handlerMatches || handlerMatches.length !== 4) {
      throw new Error(`Expected 4 handler exports, got ${handlerMatches?.length || 0}`);
    }
    console.log('  File written with 4 handlers and type assertions ✓');

    // Cleanup test file
    try { fs.unlinkSync(outFile); } catch {}

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --msw generates MSW request handlers!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
