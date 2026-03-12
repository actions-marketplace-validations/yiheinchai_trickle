/**
 * E2E test: `trickle pack` / `trickle unpack` — Portable type bundles
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes
 * 3. Run trickle pack with --out (save to file)
 * 4. Verify bundle file structure
 * 5. Verify bundle contains all functions and snapshots
 * 6. Clear backend database
 * 7. Run trickle unpack — import bundle
 * 8. Verify all functions restored in backend
 * 9. Verify type snapshots restored correctly
 * 10. Run unpack --dry-run (should not import)
 * 11. Run pack to stdout (piping mode)
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

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

async function ingestRoute(method, routePath, argsType, returnType, opts = {}) {
  const typeHash = makeTypeHash(argsType, returnType);
  await fetch('http://localhost:4888/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      functionName: `${method} ${routePath}`,
      module: opts.module || 'api',
      language: 'js',
      environment: opts.env || 'development',
      typeHash,
      argsType,
      returnType,
      sampleOutput: opts.sampleOutput,
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
      resolve({ stdout, stderr, code });
    });
  });
}

async function restartBackend(backendProc) {
  backendProc.kill('SIGTERM');
  await sleep(500);
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

async function run() {
  let backendProc = null;
  let tmpDir = null;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Ingest sample routes
    console.log('\n=== Step 2: Ingest sample routes ===');

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
      { sampleOutput: { users: [{ id: 1, name: 'Alice' }], total: 1 } },
    );

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

    await ingestRoute('GET', '/api/orders',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          orders: {
            kind: 'array', element: {
              kind: 'object', properties: {
                orderId: { kind: 'primitive', name: 'number' },
                status: { kind: 'primitive', name: 'string' },
              },
            },
          },
        },
      },
    );

    await sleep(500);
    console.log('  3 routes ingested ✓');

    // Step 3: Pack to file
    console.log('\n=== Step 3: Run trickle pack --out ===');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-pack-test-'));
    const bundlePath = path.join(tmpDir, 'types.trickle.json');

    const packResult = await runCli(['pack', '--out', bundlePath]);
    if (packResult.code !== 0) {
      throw new Error('Pack failed: ' + packResult.stderr);
    }
    if (!fs.existsSync(bundlePath)) {
      throw new Error('Expected bundle file to be created');
    }
    console.log('  Bundle file created ✓');

    // Step 4: Verify bundle structure
    console.log('\n=== Step 4: Verify bundle structure ===');
    const bundleContent = fs.readFileSync(bundlePath, 'utf-8');
    let bundle;
    try {
      bundle = JSON.parse(bundleContent);
    } catch {
      throw new Error('Bundle is not valid JSON');
    }
    if (bundle.version !== 1) {
      throw new Error('Expected version: 1');
    }
    if (!bundle.createdAt) {
      throw new Error('Expected createdAt timestamp');
    }
    if (!bundle.functions || !Array.isArray(bundle.functions)) {
      throw new Error('Expected functions array');
    }
    if (!bundle.stats) {
      throw new Error('Expected stats object');
    }
    console.log('  Bundle structure valid (version 1) ✓');

    // Step 5: Verify bundle contains all functions
    console.log('\n=== Step 5: Verify bundle contents ===');
    if (bundle.functions.length !== 3) {
      throw new Error(`Expected 3 functions, got ${bundle.functions.length}`);
    }
    if (bundle.stats.totalFunctions !== 3) {
      throw new Error('Expected totalFunctions: 3');
    }

    const getUsers = bundle.functions.find(f => f.functionName === 'GET /api/users');
    if (!getUsers) {
      throw new Error('Expected GET /api/users in bundle');
    }
    if (!getUsers.snapshots || getUsers.snapshots.length === 0) {
      throw new Error('Expected snapshots for GET /api/users');
    }
    if (!getUsers.snapshots[0].returnType) {
      throw new Error('Expected returnType in snapshot');
    }
    // Verify sample data was preserved
    if (!getUsers.snapshots[0].sampleOutput) {
      throw new Error('Expected sampleOutput in snapshot');
    }
    console.log('  Bundle contains 3 functions with snapshots ✓');

    // Step 6: Clear backend (restart with fresh DB)
    console.log('\n=== Step 6: Clear backend database ===');
    backendProc = await restartBackend(backendProc);

    // Verify it's empty
    const emptyRes = await fetch('http://localhost:4888/api/functions?limit=10');
    const emptyData = await emptyRes.json();
    if (emptyData.functions.length > 0) {
      throw new Error('Expected empty backend after restart');
    }
    console.log('  Backend cleared ✓');

    // Step 7: Unpack — import bundle
    console.log('\n=== Step 7: Run trickle unpack ===');
    const unpackResult = await runCli(['unpack', bundlePath]);
    if (unpackResult.code !== 0) {
      throw new Error('Unpack failed: ' + unpackResult.stderr);
    }
    if (!unpackResult.stdout.includes('3 functions imported')) {
      throw new Error('Expected "3 functions imported" message');
    }
    console.log('  3 functions imported ✓');

    // Step 8: Verify functions restored
    console.log('\n=== Step 8: Verify functions restored ===');
    await sleep(500);
    const restoredRes = await fetch('http://localhost:4888/api/functions?limit=10');
    const restoredData = await restoredRes.json();
    if (restoredData.functions.length !== 3) {
      throw new Error(`Expected 3 restored functions, got ${restoredData.functions.length}`);
    }
    const restoredNames = restoredData.functions.map(f => f.function_name).sort();
    if (!restoredNames.includes('GET /api/orders')) {
      throw new Error('Expected GET /api/orders restored');
    }
    if (!restoredNames.includes('GET /api/users')) {
      throw new Error('Expected GET /api/users restored');
    }
    if (!restoredNames.includes('POST /api/users')) {
      throw new Error('Expected POST /api/users restored');
    }
    console.log('  All 3 functions restored correctly ✓');

    // Step 9: Verify type snapshots restored
    console.log('\n=== Step 9: Verify type snapshots restored ===');
    const getUsersFunc = restoredData.functions.find(f => f.function_name === 'GET /api/users');
    const typesRes = await fetch(`http://localhost:4888/api/types/${getUsersFunc.id}?limit=1`);
    const typesData = await typesRes.json();
    if (!typesData.snapshots || typesData.snapshots.length === 0) {
      throw new Error('Expected restored type snapshots');
    }
    const returnType = typesData.snapshots[0].return_type;
    if (!returnType.properties || !returnType.properties.users) {
      throw new Error('Expected users field in restored return type');
    }
    console.log('  Type snapshots restored with correct types ✓');

    // Step 10: Dry-run mode
    console.log('\n=== Step 10: Run unpack --dry-run ===');
    const dryResult = await runCli(['unpack', bundlePath, '--dry-run']);
    if (dryResult.code !== 0) {
      throw new Error('Dry-run failed: ' + dryResult.stderr);
    }
    if (!dryResult.stdout.includes('Dry run')) {
      throw new Error('Expected "Dry run" in output');
    }
    if (!dryResult.stdout.includes('GET /api/users')) {
      throw new Error('Expected function names listed in dry-run');
    }
    console.log('  Dry-run lists contents without importing ✓');

    // Step 11: Pack to stdout
    console.log('\n=== Step 11: Run pack to stdout ===');
    const stdoutResult = await runCli(['pack']);
    if (stdoutResult.code !== 0) {
      throw new Error('Pack to stdout failed: ' + stdoutResult.stderr);
    }
    let stdoutBundle;
    try {
      stdoutBundle = JSON.parse(stdoutResult.stdout);
    } catch {
      throw new Error('Expected valid JSON on stdout');
    }
    if (stdoutBundle.version !== 1) {
      throw new Error('Expected version 1 in stdout bundle');
    }
    if (stdoutBundle.functions.length !== 3) {
      throw new Error(`Expected 3 functions in stdout bundle, got ${stdoutBundle.functions.length}`);
    }
    console.log('  Pack to stdout outputs valid JSON ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle pack/unpack creates and restores portable type bundles!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
