/**
 * E2E test: `trickle codegen --trpc` — tRPC router generation
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes with types
 * 3. Generate tRPC router via CLI
 * 4. Verify tRPC imports
 * 5. Verify Query procedures for GET routes
 * 6. Verify Mutation procedures for POST/PUT routes
 * 7. Verify Zod input schemas for mutations
 * 8. Verify response type interfaces
 * 9. Verify AppRouter type export
 * 10. Verify GET routes have no input schema
 * 11. Verify backend API directly (format=trpc)
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
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

function runCli(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['packages/cli/dist/index.js', ...args], {
      env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => { proc.kill(); reject(new Error('CLI timeout')); }, 30000);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`CLI exit ${code}: ${stderr || stdout}`));
      else resolve(stdout);
    });
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

    // POST /api/users — create with body
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
              email: { kind: 'primitive', name: 'string' },
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

    // GET /api/posts — another GET route
    await ingestRoute('GET', '/api/posts',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          posts: {
            kind: 'array', element: {
              kind: 'object', properties: {
                id: { kind: 'primitive', name: 'number' },
                title: { kind: 'primitive', name: 'string' },
                published: { kind: 'primitive', name: 'boolean' },
              },
            },
          },
        },
      },
    );

    await sleep(500);
    console.log('  4 routes ingested (2 GET, 1 POST, 1 PUT) ✓');

    // Step 3: Generate tRPC router via CLI
    console.log('\n=== Step 3: Generate tRPC router via CLI ===');
    const trpcOutput = await runCli(['codegen', '--trpc']);

    if (!trpcOutput.includes('Auto-generated tRPC router')) {
      throw new Error('Expected tRPC header comment');
    }
    console.log('  tRPC router generated via --trpc flag ✓');

    // Step 4: Verify tRPC imports
    console.log('\n=== Step 4: Verify tRPC imports ===');
    if (!trpcOutput.includes('from "@trpc/server"')) {
      throw new Error('Expected @trpc/server import');
    }
    if (!trpcOutput.includes('from "zod"')) {
      throw new Error('Expected zod import');
    }
    if (!trpcOutput.includes('initTRPC')) {
      throw new Error('Expected initTRPC import');
    }
    if (!trpcOutput.includes('const t = initTRPC.create()')) {
      throw new Error('Expected tRPC initialization');
    }
    console.log('  @trpc/server and zod imports present ✓');

    // Step 5: Verify query procedures for GET routes
    console.log('\n=== Step 5: Verify query procedures ===');
    if (!trpcOutput.includes('.query(')) {
      throw new Error('Expected .query() procedure');
    }
    if (!trpcOutput.includes('getApiUsers')) {
      throw new Error('Expected getApiUsers procedure');
    }
    if (!trpcOutput.includes('getApiPosts')) {
      throw new Error('Expected getApiPosts procedure');
    }
    console.log('  GET routes produce .query() procedures ✓');

    // Step 6: Verify mutation procedures for POST/PUT routes
    console.log('\n=== Step 6: Verify mutation procedures ===');
    if (!trpcOutput.includes('.mutation(')) {
      throw new Error('Expected .mutation() procedure');
    }
    if (!trpcOutput.includes('postApiUsers')) {
      throw new Error('Expected postApiUsers procedure');
    }
    if (!trpcOutput.includes('putApiUsersId')) {
      throw new Error('Expected putApiUsersId procedure');
    }
    console.log('  POST/PUT routes produce .mutation() procedures ✓');

    // Step 7: Verify Zod input schemas
    console.log('\n=== Step 7: Verify Zod input schemas ===');
    if (!trpcOutput.includes('z.object(')) {
      throw new Error('Expected z.object() in input schemas');
    }
    if (!trpcOutput.includes('z.string()')) {
      throw new Error('Expected z.string() in input schemas');
    }
    if (!trpcOutput.includes('z.number()')) {
      throw new Error('Expected z.number() in input schemas');
    }
    if (!trpcOutput.includes('.input(')) {
      throw new Error('Expected .input() on mutation procedures');
    }
    console.log('  Zod input schemas with z.object/z.string/z.number ✓');

    // Step 8: Verify response type interfaces
    console.log('\n=== Step 8: Verify response type interfaces ===');
    if (!trpcOutput.includes('export interface')) {
      throw new Error('Expected export interface for response types');
    }
    if (!trpcOutput.includes('Response')) {
      throw new Error('Expected Response suffix on type interfaces');
    }
    console.log('  Response type interfaces present ✓');

    // Step 9: Verify AppRouter type export
    console.log('\n=== Step 9: Verify AppRouter export ===');
    if (!trpcOutput.includes('export const appRouter = t.router(')) {
      throw new Error('Expected appRouter definition');
    }
    if (!trpcOutput.includes('export type AppRouter = typeof appRouter')) {
      throw new Error('Expected AppRouter type export');
    }
    console.log('  appRouter and AppRouter type exported ✓');

    // Step 10: Verify GET routes have no input schema
    console.log('\n=== Step 10: Verify GET routes have no .input() ===');
    // Extract the getApiUsers procedure - it should have .query but not .input
    const getApiUsersIdx = trpcOutput.indexOf('getApiUsers:');
    const getApiUsersEnd = trpcOutput.indexOf('.query(', getApiUsersIdx);
    if (getApiUsersIdx !== -1 && getApiUsersEnd !== -1) {
      const procedureSlice = trpcOutput.slice(getApiUsersIdx, getApiUsersEnd);
      if (procedureSlice.includes('.input(')) {
        throw new Error('GET route should not have .input() when no query params');
      }
    }
    console.log('  GET routes correctly have no .input() ✓');

    // Step 11: Verify backend API directly
    console.log('\n=== Step 11: Verify backend API (format=trpc) ===');
    const apiRes = await fetch('http://localhost:4888/api/codegen?format=trpc');
    const apiData = await apiRes.json();
    if (!apiData.types || !apiData.types.includes('appRouter')) {
      throw new Error('Backend API should return tRPC router');
    }
    console.log('  Backend API returns tRPC router correctly ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --trpc generates typed tRPC router!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
