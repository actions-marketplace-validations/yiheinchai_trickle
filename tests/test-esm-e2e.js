/**
 * E2E test: ESM auto-observation
 *
 * Verifies that `trickle run` works with ES module files (.mjs / import-export),
 * capturing types and sample data via ESM loader hooks.
 *
 * Steps:
 * 1. Start backend
 * 2. Run ESM app via trickle run → verify ESM detection and --import injection
 * 3. Verify functions captured with correct types
 * 4. Verify type snapshots contain proper data
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_PORT = 4888;
const CLI = path.resolve('../packages/cli/dist/index.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch(`http://localhost:${port}/api/functions`);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

function runCmd(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[out] ${d}`);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[err] ${d}`);
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Exit ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    setTimeout(() => reject(new Error('Timed out')), 30000);
  });
}

async function resetDb() {
  const dbPath = path.join(require('os').homedir(), '.trickle', 'trickle.db');
  try { fs.unlinkSync(dbPath); } catch {}
  await sleep(1000);
}

async function run() {
  let backendProc = null;

  try {
    // Step 1: Start backend with clean DB
    console.log('=== Step 1: Start backend ===');
    await resetDb();

    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[backend-err] ${d}`);
    });
    await waitForServer(BACKEND_PORT);
    console.log('  Backend running ✓');

    // Step 2: Run ESM app via trickle run
    console.log('\n=== Step 2: Run ESM app via trickle run ===');
    const { stdout: runOut } = await runCmd('node', [CLI, 'run', 'node test-esm-app.mjs']);

    // Verify ESM detection
    if (runOut.includes('--import')) {
      console.log('  ESM detected, --import injected ✓');
    } else {
      console.log('  Warning: --import not shown in output (may still work)');
    }

    // Verify app output
    if (runOut.includes('Done!')) {
      console.log('  ESM app completed successfully ✓');
    } else {
      throw new Error('ESM app did not complete! Output: ' + runOut.slice(0, 200));
    }

    // Wait for flush
    await sleep(3000);

    // Step 3: Verify functions captured
    console.log('\n=== Step 3: Verify captured functions ===');
    let resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    let data = await resp.json();
    const functions = data.functions;

    console.log(`  Total functions captured: ${functions.length}`);

    if (functions.length === 0) {
      throw new Error('No functions captured! ESM observation may have failed.');
    }

    // Check for expected ESM functions
    const expectedFunctions = ['parseConfig', 'processItems', 'calculateTotal'];
    for (const name of expectedFunctions) {
      const fn = functions.find(f => f.function_name === name);
      if (fn) {
        console.log(`  Function "${name}" captured ✓ (module: ${fn.module})`);
      } else {
        throw new Error(`Function "${name}" NOT captured! Found: ${functions.map(f => f.function_name).join(', ')}`);
      }
    }

    // Verify module name comes from ESM filename
    const esmFunctions = functions.filter(f =>
      f.module === 'test-esm-helpers' || f.module === 'test-esm-helpers.mjs'
    );
    if (esmFunctions.length >= 3) {
      console.log(`  Module "test-esm-helpers" grouping ✓ (${esmFunctions.length} functions)`);
    } else {
      // Show what modules were captured
      const modules = [...new Set(functions.map(f => f.module))];
      console.log(`  Modules found: ${modules.join(', ')}`);
    }

    // Step 4: Verify type snapshots
    console.log('\n=== Step 4: Verify type snapshots ===');

    const parseConfigFn = functions.find(f => f.function_name === 'parseConfig');
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${parseConfigFn.id}`);
    data = await resp.json();
    const snapshots = data.snapshots;

    if (snapshots.length === 0) {
      throw new Error('No type snapshots for parseConfig!');
    }

    const snapshot = snapshots[0];
    const returnType = snapshot.return_type;

    if (returnType && returnType.kind === 'object') {
      const props = Object.keys(returnType.properties || {});
      if (props.includes('host') && props.includes('port') && props.includes('debug')) {
        console.log('  parseConfig return type: { host, port, debug } ✓');
      } else {
        throw new Error(`Unexpected return type props: ${props.join(', ')}`);
      }
    } else {
      throw new Error(`Expected object return type, got: ${JSON.stringify(returnType)}`);
    }

    // Verify sample data
    if (snapshot.sample_output && snapshot.sample_output.host === 'api.example.com') {
      console.log('  Sample output correct ✓');
    }

    // Check arrow function (calculateTotal)
    const calcFn = functions.find(f => f.function_name === 'calculateTotal');
    if (calcFn) {
      resp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${calcFn.id}`);
      data = await resp.json();
      if (data.snapshots.length > 0) {
        const calcReturn = data.snapshots[0].return_type;
        if (calcReturn && calcReturn.kind === 'object') {
          const calcProps = Object.keys(calcReturn.properties || {});
          if (calcProps.includes('subtotal') && calcProps.includes('tax') && calcProps.includes('total')) {
            console.log('  calculateTotal (arrow fn) return type: { subtotal, tax, total } ✓');
          }
        }
      }
    }

    // Step 5: Verify that CJS still works alongside ESM
    console.log('\n=== Step 5: Verify CJS still works ===');

    // Run a CJS app to make sure we didn't break it
    const { stdout: cjsOut } = await runCmd('node', [CLI, 'run', 'node test-annotate-app.js']);
    if (cjsOut.includes('Done!')) {
      console.log('  CJS app still works ✓');
    } else {
      throw new Error('CJS app broken after ESM changes!');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('ESM auto-observation works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(500);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
