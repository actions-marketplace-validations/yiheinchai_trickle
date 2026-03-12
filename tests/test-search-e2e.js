/**
 * E2E test: `trickle search <query>` — Type-aware search across observed types
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes with types
 * 3. Search by field name (email)
 * 4. Search by primitive type (boolean)
 * 5. Search by function name pattern (users)
 * 6. Search with no results
 * 7. Verify match paths include response/args prefixes
 * 8. Verify nested field search (street)
 * 9. Verify JSON output mode
 * 10. Verify backend API directly
 * 11. Verify search is case-insensitive
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
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

function runCli(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['../packages/cli/dist/index.js', ...args], {
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

    // GET /api/users — list with email field
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
                active: { kind: 'primitive', name: 'boolean' },
              },
            },
          },
          total: { kind: 'primitive', name: 'number' },
        },
      },
    );

    // POST /api/users — create with email in body
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

    // GET /api/orders — no email, has address
    await ingestRoute('GET', '/api/orders',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          orders: {
            kind: 'array', element: {
              kind: 'object', properties: {
                orderId: { kind: 'primitive', name: 'number' },
                total: { kind: 'primitive', name: 'number' },
                address: {
                  kind: 'object', properties: {
                    street: { kind: 'primitive', name: 'string' },
                    city: { kind: 'primitive', name: 'string' },
                    zip: { kind: 'primitive', name: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    );

    await sleep(500);
    console.log('  3 routes ingested ✓');

    // Step 3: Search by field name (email)
    console.log('\n=== Step 3: Search by field name "email" ===');
    const emailSearch = await runCli(['search', 'email']);
    if (!emailSearch.includes('email')) {
      throw new Error('Expected email field in search results');
    }
    // Should find 2 functions (GET /api/users has email in response, POST /api/users has email in args)
    if (!emailSearch.includes('GET /api/users')) {
      throw new Error('Expected GET /api/users in email search');
    }
    if (!emailSearch.includes('POST /api/users')) {
      throw new Error('Expected POST /api/users in email search');
    }
    // Should NOT find orders
    if (emailSearch.includes('/api/orders')) {
      throw new Error('Orders should not appear in email search');
    }
    console.log('  Found email field in GET and POST /api/users ✓');

    // Step 4: Search by primitive type (boolean)
    console.log('\n=== Step 4: Search by type "boolean" ===');
    const boolSearch = await runCli(['search', 'boolean']);
    if (!boolSearch.includes('boolean')) {
      throw new Error('Expected boolean type in search results');
    }
    // Should match active (boolean) and created (boolean)
    if (!boolSearch.includes('GET /api/users')) {
      throw new Error('Expected GET /api/users in boolean search (active field)');
    }
    console.log('  Found boolean fields across routes ✓');

    // Step 5: Search by function name pattern
    console.log('\n=== Step 5: Search by function name "orders" ===');
    const ordersSearch = await runCli(['search', 'orders']);
    if (!ordersSearch.includes('/api/orders')) {
      throw new Error('Expected /api/orders in search results');
    }
    console.log('  Found /api/orders by name pattern ✓');

    // Step 6: Search with no results
    console.log('\n=== Step 6: Search with no results ===');
    const noResults = await runCli(['search', 'xyznonexistent']);
    if (!noResults.includes('No matches found')) {
      throw new Error('Expected "No matches found" message');
    }
    console.log('  "No matches found" for nonexistent query ✓');

    // Step 7: Verify match paths include response/args prefixes
    console.log('\n=== Step 7: Verify match paths ===');
    const jsonSearch = await runCli(['search', 'email', '--json']);
    const jsonData = JSON.parse(jsonSearch);
    const getResult = jsonData.results.find(r => r.functionName === 'GET /api/users');
    if (!getResult) throw new Error('Expected GET /api/users in JSON results');
    const responsePath = getResult.matches.find(m => m.path.startsWith('response'));
    if (!responsePath) {
      throw new Error('Expected response-prefixed path for GET route email field');
    }
    const postResult = jsonData.results.find(r => r.functionName === 'POST /api/users');
    if (!postResult) throw new Error('Expected POST /api/users in JSON results');
    const argsPath = postResult.matches.find(m => m.path.startsWith('args'));
    if (!argsPath) {
      throw new Error('Expected args-prefixed path for POST route email field');
    }
    console.log('  Match paths have response/args prefixes ✓');

    // Step 8: Verify nested field search
    console.log('\n=== Step 8: Verify nested field search "street" ===');
    const streetSearch = await runCli(['search', 'street']);
    if (!streetSearch.includes('/api/orders')) {
      throw new Error('Expected /api/orders for nested street field');
    }
    if (!streetSearch.includes('street')) {
      throw new Error('Expected street in results');
    }
    console.log('  Found nested street field in orders ✓');

    // Step 9: Verify JSON output mode
    console.log('\n=== Step 9: Verify JSON output mode ===');
    const jsonOut = await runCli(['search', 'email', '--json']);
    const parsed = JSON.parse(jsonOut);
    if (typeof parsed.total !== 'number') {
      throw new Error('Expected total count in JSON output');
    }
    if (!Array.isArray(parsed.results)) {
      throw new Error('Expected results array in JSON output');
    }
    if (!parsed.results[0].matches || !Array.isArray(parsed.results[0].matches)) {
      throw new Error('Expected matches array in each result');
    }
    console.log('  JSON output has query, total, results with matches ✓');

    // Step 10: Verify backend API directly
    console.log('\n=== Step 10: Verify backend API directly ===');
    const apiRes = await fetch('http://localhost:4888/api/search?q=email');
    const apiData = await apiRes.json();
    if (!apiData.results || apiData.total < 2) {
      throw new Error('Backend API should return at least 2 results for email');
    }
    console.log('  Backend API /api/search works correctly ✓');

    // Step 11: Verify case-insensitive search
    console.log('\n=== Step 11: Verify case-insensitive search ===');
    const upperSearch = await runCli(['search', 'EMAIL', '--json']);
    const upperData = JSON.parse(upperSearch);
    if (upperData.total < 2) {
      throw new Error('Case-insensitive search should find email fields');
    }
    console.log('  Case-insensitive search works ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle search works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
