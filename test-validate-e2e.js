/**
 * E2E test: `trickle validate <method> <url>` — Validate API against observed types
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Start test API server
 * 3. Capture types from test API (establish baseline)
 * 4. Validate matching response (should pass)
 * 5. Change API response (add extra field)
 * 6. Validate with extra field (warning, still passes)
 * 7. Validate with --strict (extra field becomes error)
 * 8. Change API response (remove field)
 * 9. Validate with missing field (should fail)
 * 10. Change API response (wrong type)
 * 11. Validate with type mismatch (should fail)
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
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
      // Don't reject on non-zero exit — we need to check output for expected failures
      resolve({ stdout, stderr, code });
    });
  });
}

// Mutable response data for the test API
let apiResponse = {
  users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
  total: 1,
  page: 1,
};

function startTestApi(port) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(apiResponse));
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

async function run() {
  let backendProc = null;
  let testApi = null;
  const PORT = 9878;
  const ENV = { TRICKLE_BACKEND_URL: 'http://localhost:4888' };

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Start test API
    console.log('\n=== Step 2: Start test API server ===');
    testApi = await startTestApi(PORT);
    console.log(`  Test API running on port ${PORT} ✓`);

    // Step 3: Capture types (establish baseline)
    console.log('\n=== Step 3: Capture types (establish baseline) ===');
    const captureResult = await runCli(['capture', 'GET', `http://localhost:${PORT}/api/users`]);
    if (captureResult.code !== 0) {
      throw new Error('Capture failed: ' + captureResult.stderr);
    }
    if (!captureResult.stdout.includes('Types captured successfully')) {
      throw new Error('Expected capture success message');
    }
    await sleep(500);
    console.log('  Baseline types captured ✓');

    // Step 4: Validate matching response (should pass)
    console.log('\n=== Step 4: Validate matching response ===');
    const validResult = await runCli(['validate', 'GET', `http://localhost:${PORT}/api/users`]);
    if (validResult.code !== 0) {
      throw new Error('Validation should pass for matching response');
    }
    if (!validResult.stdout.includes('matches observed type shape')) {
      throw new Error('Expected match success message');
    }
    console.log('  Matching response validates successfully ✓');

    // Step 5: Add extra field to response
    console.log('\n=== Step 5: Add extra field to API response ===');
    apiResponse = {
      users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
      total: 1,
      page: 1,
      newField: 'surprise',
    };
    console.log('  API now returns extra "newField" ✓');

    // Step 6: Validate with extra field (non-strict: warning, passes)
    console.log('\n=== Step 6: Validate with extra field (non-strict) ===');
    const extraResult = await runCli(['validate', 'GET', `http://localhost:${PORT}/api/users`]);
    // Non-strict mode: extra fields are OK (exit 0)
    if (extraResult.code !== 0) {
      throw new Error('Non-strict validation should pass with extra fields');
    }
    console.log('  Extra field ignored in non-strict mode ✓');

    // Step 7: Validate with --strict (extra field becomes error)
    console.log('\n=== Step 7: Validate with --strict ===');
    const strictResult = await runCli(['validate', 'GET', `http://localhost:${PORT}/api/users`, '--strict']);
    if (!strictResult.stdout.includes('EXTRA') && !strictResult.stderr.includes('EXTRA')) {
      throw new Error('Expected EXTRA field warning in strict mode');
    }
    if (!strictResult.stdout.includes('newField')) {
      throw new Error('Expected newField in strict mode output');
    }
    console.log('  Extra field reported in strict mode ✓');

    // Step 8: Remove a field from response
    console.log('\n=== Step 8: Remove field from API response ===');
    apiResponse = {
      users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
      // total is missing
      page: 1,
    };
    console.log('  API now missing "total" field ✓');

    // Step 9: Validate with missing field (should fail)
    console.log('\n=== Step 9: Validate with missing field ===');
    const missingResult = await runCli(['validate', 'GET', `http://localhost:${PORT}/api/users`]);
    if (missingResult.code === 0) {
      throw new Error('Validation should fail when field is missing');
    }
    if (!missingResult.stdout.includes('MISSING')) {
      throw new Error('Expected MISSING in output');
    }
    if (!missingResult.stdout.includes('total')) {
      throw new Error('Expected total field in missing report');
    }
    console.log('  Missing "total" field detected ✓');

    // Step 10: Change field type
    console.log('\n=== Step 10: Change field type ===');
    apiResponse = {
      users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
      total: 'not_a_number',  // was number, now string
      page: 1,
    };
    console.log('  API now returns total as string (was number) ✓');

    // Step 11: Validate with type mismatch (should fail)
    console.log('\n=== Step 11: Validate with type mismatch ===');
    const typeResult = await runCli(['validate', 'GET', `http://localhost:${PORT}/api/users`]);
    if (typeResult.code === 0) {
      throw new Error('Validation should fail on type mismatch');
    }
    if (!typeResult.stdout.includes('TYPE') && !typeResult.stdout.includes('mismatch')) {
      throw new Error('Expected type mismatch in output');
    }
    console.log('  Type mismatch (number → string) detected ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle validate works end-to-end!\n');

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
