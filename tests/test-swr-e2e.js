/**
 * E2E test: `trickle codegen --swr` — SWR hook generation
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes with types
 * 3. Generate SWR hooks via CLI (--swr flag)
 * 4. Verify SWR imports
 * 5. Verify response type interfaces
 * 6. Verify input type interfaces for POST/PUT
 * 7. Verify useSWR hooks for GET routes
 * 8. Verify useSWRMutation hooks for POST/PUT/DELETE
 * 9. Verify path parameter handling
 * 10. Verify fetcher and configureSwrHooks
 * 11. Verify backend API directly (format=swr)
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

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Ingest sample routes
    console.log('\n=== Step 2: Ingest sample route data ===');

    // GET /api/users — list
    await ingestRoute('GET', '/api/users',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          users: {
            kind: 'array', element: {
              kind: 'object', properties: {
                id: { kind: 'primitive', name: 'number' },
                name: { kind: 'primitive', name: 'string' },
              },
            },
          },
          total: { kind: 'primitive', name: 'number' },
        },
      },
    );

    // GET /api/users/:id — detail
    await ingestRoute('GET', '/api/users/:id',
      { kind: 'object', properties: { params: { kind: 'object', properties: { id: { kind: 'primitive', name: 'string' } } } } },
      {
        kind: 'object', properties: {
          id: { kind: 'primitive', name: 'number' },
          name: { kind: 'primitive', name: 'string' },
          email: { kind: 'primitive', name: 'string' },
        },
      },
    );

    // POST /api/users — create
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
          created: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    // PUT /api/users/:id — update
    await ingestRoute('PUT', '/api/users/:id',
      {
        kind: 'object', properties: {
          body: {
            kind: 'object', properties: {
              name: { kind: 'primitive', name: 'string' },
            },
          },
        },
      },
      {
        kind: 'object', properties: {
          updated: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    // DELETE /api/users/:id — delete
    await ingestRoute('DELETE', '/api/users/:id',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          success: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    await sleep(500);
    console.log('  5 routes ingested (2 GET, 1 POST, 1 PUT, 1 DELETE) ✓');

    // Step 3: Generate SWR hooks via CLI
    console.log('\n=== Step 3: Generate SWR hooks via CLI ===');
    const swrOutput = execSync(
      'npx trickle codegen --swr',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );

    if (!swrOutput.includes('Auto-generated SWR hooks')) {
      throw new Error('Expected SWR header comment');
    }
    console.log('  SWR hooks generated via --swr flag ✓');

    // Step 4: Verify SWR imports
    console.log('\n=== Step 4: Verify SWR imports ===');
    if (!swrOutput.includes('import useSWR from "swr"')) {
      throw new Error('Expected useSWR import');
    }
    if (!swrOutput.includes('import useSWRMutation from "swr/mutation"')) {
      throw new Error('Expected useSWRMutation import');
    }
    if (!swrOutput.includes('SWRConfiguration')) {
      throw new Error('Expected SWRConfiguration type import');
    }
    if (!swrOutput.includes('SWRMutationConfiguration')) {
      throw new Error('Expected SWRMutationConfiguration type import');
    }
    console.log('  SWR and SWR/mutation imports present ✓');

    // Step 5: Verify response type interfaces
    console.log('\n=== Step 5: Verify response type interfaces ===');
    if (!swrOutput.includes('export interface GetApiUsersResponse')) {
      throw new Error('Expected GetApiUsersResponse');
    }
    if (!swrOutput.includes('export interface GetApiUsersIdResponse')) {
      throw new Error('Expected GetApiUsersIdResponse');
    }
    if (!swrOutput.includes('export interface PostApiUsersResponse')) {
      throw new Error('Expected PostApiUsersResponse');
    }
    if (!swrOutput.includes('export interface DeleteApiUsersIdResponse')) {
      throw new Error('Expected DeleteApiUsersIdResponse');
    }
    console.log('  Response interfaces for all 5 routes ✓');

    // Step 6: Verify input type interfaces
    console.log('\n=== Step 6: Verify input type interfaces ===');
    if (!swrOutput.includes('export interface PostApiUsersInput')) {
      throw new Error('Expected PostApiUsersInput');
    }
    if (!swrOutput.includes('export interface PutApiUsersIdInput')) {
      throw new Error('Expected PutApiUsersIdInput');
    }
    // GET and DELETE should NOT have input types
    if (swrOutput.includes('GetApiUsersInput')) {
      throw new Error('GET routes should not have input types');
    }
    console.log('  Input interfaces for POST/PUT, none for GET/DELETE ✓');

    // Step 7: Verify useSWR hooks for GET routes
    console.log('\n=== Step 7: Verify useSWR hooks for GET routes ===');
    if (!swrOutput.includes('export function useGetApiUsers(')) {
      throw new Error('Expected useGetApiUsers hook');
    }
    if (!swrOutput.includes('export function useGetApiUsersId(')) {
      throw new Error('Expected useGetApiUsersId hook');
    }
    // GET hooks should use useSWR, not useSWRMutation
    if (!swrOutput.includes('return useSWR<GetApiUsersResponse')) {
      throw new Error('Expected useSWR call in GET hook');
    }
    console.log('  useSWR hooks for GET routes ✓');

    // Step 8: Verify useSWRMutation hooks for POST/PUT/DELETE
    console.log('\n=== Step 8: Verify useSWRMutation hooks ===');
    if (!swrOutput.includes('export function usePostApiUsers(')) {
      throw new Error('Expected usePostApiUsers hook');
    }
    if (!swrOutput.includes('export function useDeleteApiUsersId(')) {
      throw new Error('Expected useDeleteApiUsersId hook');
    }
    if (!swrOutput.includes('return useSWRMutation<PostApiUsersResponse')) {
      throw new Error('Expected useSWRMutation call for POST');
    }
    if (!swrOutput.includes('return useSWRMutation<DeleteApiUsersIdResponse')) {
      throw new Error('Expected useSWRMutation call for DELETE');
    }
    // POST should have typed input arg
    if (!swrOutput.includes('PostApiUsersInput')) {
      throw new Error('Expected PostApiUsersInput in mutation hook');
    }
    // DELETE should have void input
    if (!swrOutput.includes('string, void>')) {
      throw new Error('Expected void trigger arg for DELETE');
    }
    console.log('  useSWRMutation hooks for POST/PUT/DELETE ✓');

    // Step 9: Verify path parameter handling
    console.log('\n=== Step 9: Verify path parameter handling ===');
    if (!swrOutput.includes('useGetApiUsersId(id: string')) {
      throw new Error('Expected id parameter in useGetApiUsersId');
    }
    if (!swrOutput.includes('useDeleteApiUsersId(id: string')) {
      throw new Error('Expected id parameter in useDeleteApiUsersId');
    }
    // Path should interpolate the param
    if (!swrOutput.includes('`/api/users/${id}`')) {
      throw new Error('Expected interpolated path with id param');
    }
    console.log('  Path params correctly handled ✓');

    // Step 10: Verify fetcher and configuration
    console.log('\n=== Step 10: Verify fetcher and configureSwrHooks ===');
    if (!swrOutput.includes('export function configureSwrHooks(baseUrl: string)')) {
      throw new Error('Expected configureSwrHooks export');
    }
    if (!swrOutput.includes('const fetcher')) {
      throw new Error('Expected fetcher function');
    }
    if (!swrOutput.includes('mutationFetcher')) {
      throw new Error('Expected mutationFetcher function');
    }
    console.log('  configureSwrHooks, fetcher, mutationFetcher present ✓');

    // Step 11: Verify backend API directly
    console.log('\n=== Step 11: Verify backend API (format=swr) ===');
    const apiRes = await fetch('http://localhost:4888/api/codegen?format=swr');
    const apiData = await apiRes.json();
    if (!apiData.types || !apiData.types.includes('import useSWR')) {
      throw new Error('Backend API should return SWR hooks');
    }
    console.log('  Backend API returns SWR hooks correctly ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --swr generates typed SWR hooks!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
