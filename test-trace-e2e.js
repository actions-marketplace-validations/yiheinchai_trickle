/**
 * E2E test: `trickle trace` — Type-annotated HTTP request viewer
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Start test API server
 * 3. Trace a GET request — verify annotated output
 * 4. Verify type annotations (// string, // number) in output
 * 5. Verify array annotation shown
 * 6. Trace a POST request with body
 * 7. Verify response timing shown
 * 8. Trace with --save — verify types stored in backend
 * 9. Verify saved function exists in backend
 * 10. Trace nested JSON response
 * 11. Verify nested annotations
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const http = require('http');

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
      resolve({ stdout, stderr, code });
    });
  });
}

// Mutable response for the test API
let apiResponse = {};
let apiStatusCode = 200;

function startTestApi(port) {
  const server = http.createServer((req, res) => {
    res.writeHead(apiStatusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(apiResponse));
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

async function run() {
  let backendProc = null;
  let testApi = null;
  const PORT = 9879;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Start test API
    console.log('\n=== Step 2: Start test API server ===');
    apiResponse = {
      users: [
        { id: 1, name: 'Alice', email: 'alice@test.com', active: true },
        { id: 2, name: 'Bob', email: 'bob@test.com', active: false },
      ],
      total: 2,
      page: 1,
    };
    testApi = await startTestApi(PORT);
    console.log(`  Test API running on port ${PORT} ✓`);

    // Step 3: Trace GET request
    console.log('\n=== Step 3: Trace GET request ===');
    const result1 = await runCli(['trace', 'GET', `http://localhost:${PORT}/api/users`]);
    if (result1.code !== 0) {
      throw new Error('Trace failed: ' + result1.stderr);
    }
    if (!result1.stdout.includes('trickle trace')) {
      throw new Error('Expected trickle trace header');
    }
    if (!result1.stdout.includes('200')) {
      throw new Error('Expected 200 status in output');
    }
    console.log('  Trace GET request shows response ✓');

    // Step 4: Verify type annotations
    console.log('\n=== Step 4: Verify type annotations ===');
    if (!result1.stdout.includes('// string')) {
      throw new Error('Expected // string annotation');
    }
    if (!result1.stdout.includes('// number')) {
      throw new Error('Expected // number annotation');
    }
    if (!result1.stdout.includes('// boolean')) {
      throw new Error('Expected // boolean annotation');
    }
    console.log('  Type annotations (string, number, boolean) present ✓');

    // Step 5: Verify array annotation
    console.log('\n=== Step 5: Verify array annotation ===');
    // Should show array type like {id, name, email, active}[]
    if (!result1.stdout.includes('[]')) {
      throw new Error('Expected array annotation with []');
    }
    console.log('  Array annotation shown ✓');

    // Step 6: Trace POST with body
    console.log('\n=== Step 6: Trace POST request with body ===');
    apiResponse = { id: 3, created: true };
    const result2 = await runCli([
      'trace', 'POST', `http://localhost:${PORT}/api/users`,
      '-d', '{"name":"Charlie","email":"charlie@test.com"}',
    ]);
    if (result2.code !== 0) {
      throw new Error('Trace POST failed: ' + result2.stderr);
    }
    if (!result2.stdout.includes('POST')) {
      throw new Error('Expected POST in output');
    }
    if (!result2.stdout.includes('created')) {
      throw new Error('Expected created field in output');
    }
    console.log('  POST request traced with body ✓');

    // Step 7: Verify timing
    console.log('\n=== Step 7: Verify response timing ===');
    if (!result2.stdout.includes('ms)')) {
      throw new Error('Expected timing in ms');
    }
    console.log('  Response timing shown ✓');

    // Step 8: Trace with --save
    console.log('\n=== Step 8: Trace with --save ===');
    apiResponse = {
      users: [{ id: 1, name: 'Alice', email: 'alice@test.com', active: true }],
      total: 1,
      page: 1,
    };
    const result3 = await runCli([
      'trace', 'GET', `http://localhost:${PORT}/api/users`, '--save',
    ]);
    if (result3.code !== 0) {
      throw new Error('Trace --save failed: ' + result3.stderr);
    }
    if (!result3.stdout.includes('Types saved')) {
      throw new Error('Expected "Types saved" confirmation');
    }
    console.log('  Types saved to backend ✓');

    // Step 9: Verify saved function in backend
    console.log('\n=== Step 9: Verify saved function in backend ===');
    await sleep(500);
    const funcsRes = await fetch('http://localhost:4888/api/functions?q=GET+%2Fapi%2Fusers&limit=10');
    const funcsData = await funcsRes.json();
    const savedFunc = funcsData.functions.find(f => f.function_name === 'GET /api/users');
    if (!savedFunc) {
      throw new Error('Expected GET /api/users saved in backend');
    }
    console.log('  GET /api/users exists in backend ✓');

    // Step 10: Trace nested JSON
    console.log('\n=== Step 10: Trace nested JSON response ===');
    apiResponse = {
      data: {
        org: {
          id: 'org-1',
          name: 'Acme Corp',
          settings: {
            theme: 'dark',
            maxUsers: 100,
          },
        },
      },
      meta: { requestId: 'abc-123', cached: false },
    };
    const result4 = await runCli(['trace', 'GET', `http://localhost:${PORT}/api/org`]);
    if (result4.code !== 0) {
      throw new Error('Trace nested failed: ' + result4.stderr);
    }
    console.log('  Nested JSON traced ✓');

    // Step 11: Verify nested annotations
    console.log('\n=== Step 11: Verify nested annotations ===');
    if (!result4.stdout.includes('Acme Corp') && !result4.stdout.includes('Acme')) {
      throw new Error('Expected Acme Corp in nested output');
    }
    if (!result4.stdout.includes('// string')) {
      throw new Error('Expected string annotation in nested output');
    }
    // Check field count summary
    if (!result4.stdout.includes('fields')) {
      throw new Error('Expected fields count in summary');
    }
    console.log('  Nested annotations correct ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle trace shows type-annotated API responses!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (testApi) { testApi.close(); }
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
