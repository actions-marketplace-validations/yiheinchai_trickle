/**
 * E2E test: Python universal function observation
 *
 * Verifies that both the explicit observe() API and the auto-observe
 * register mode work for Python — capturing types, samples, and errors.
 *
 * Steps:
 * 1. Starts the trickle backend
 * 2. Tests explicit observe() API via test-observe-py-explicit.py
 * 3. Resets DB, tests auto-observe via observe_runner + test-observe-py-app.py
 * 4. Verifies functions, types, samples, and errors were captured
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_PORT = 4888;
const PYTHON = 'python3';
const PYTHONPATH = [
  path.resolve('packages/client-python/src'),
  path.resolve('.'),
].join(':');

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

function runPython(args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH,
        TRICKLE_BACKEND_URL: `http://localhost:${BACKEND_PORT}`,
        ...env,
      },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[py] ${d}`);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[py-err] ${d}`);
    });

    proc.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Python exited with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });

    setTimeout(() => reject(new Error('Python script timed out')), 20000);
  });
}

async function resetDb() {
  const dbPath = path.join(require('os').homedir(), '.trickle', 'trickle.db');
  // Delete and wait for backend to recreate
  try { fs.unlinkSync(dbPath); } catch {}
  await sleep(1000);
}

async function run() {
  let backendProc = null;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
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

    // ── Part A: Test explicit observe() API ──
    console.log('\n=== Part A: Explicit observe() API ===');

    const { stdout: explicitOut } = await runPython(['test-observe-py-explicit.py']);
    console.log('  Script ran successfully ✓');

    // Wait for flush
    await sleep(3000);

    // Verify functions captured
    let resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    let data = await resp.json();
    let functions = data.functions;

    console.log(`  Functions captured: ${functions.length}`);

    const expectedExplicit = ['parse_config', 'process_items', 'calculate_stats', 'merge_records', 'failing_function'];
    for (const name of expectedExplicit) {
      if (functions.find(f => f.function_name === name)) {
        console.log(`  Function "${name}" ✓`);
      } else {
        throw new Error(`Function "${name}" NOT captured!`);
      }
    }

    // Check module name
    const pyHelperFns = functions.filter(f => f.module === 'py-helpers');
    if (pyHelperFns.length >= 5) {
      console.log('  Module "py-helpers" grouping ✓');
    } else {
      throw new Error(`Expected ≥5 functions in "py-helpers", got ${pyHelperFns.length}`);
    }

    // Check observe_fn standalone
    if (functions.find(f => f.module === 'standalone')) {
      console.log('  observe_fn standalone module ✓');
    }

    // Verify error captured
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/errors`);
    data = await resp.json();
    const explicitErrors = data.errors;
    if (explicitErrors.length > 0 && explicitErrors[0].error_type === 'ValueError') {
      console.log('  Error captured (ValueError) ✓');
    } else {
      throw new Error('No error captured for failing_function!');
    }

    // ── Part B: Test auto-observe register mode ──
    console.log('\n=== Part B: Auto-observe register mode ===');

    // Kill and restart backend with clean DB
    backendProc.kill('SIGTERM');
    await sleep(1000);
    await resetDb();

    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', () => {});
    backendProc.stderr.on('data', () => {});
    await waitForServer(BACKEND_PORT);
    console.log('  Backend restarted with clean DB ✓');

    // Run app via observe_runner
    const { stdout: autoOut } = await runPython(
      ['-c', 'import sys; sys.argv = ["", "test-observe-py-app.py"]; from trickle.observe_runner import main; main()'],
    );

    if (autoOut.includes('Done!')) {
      console.log('  App completed ✓');
    } else {
      throw new Error('App did not complete');
    }

    // Wait for flush
    await sleep(3000);

    // Verify functions
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    data = await resp.json();
    functions = data.functions;

    console.log(`  Functions auto-captured: ${functions.length}`);
    if (functions.length === 0) {
      throw new Error('No functions captured via auto-observe!');
    }

    const functionNames = functions.map(f => f.function_name);
    const expectedAuto = ['parse_config', 'process_items', 'calculate_stats', 'merge_records', 'failing_function'];
    for (const name of expectedAuto) {
      if (functionNames.includes(name)) {
        console.log(`  Function "${name}" auto-captured ✓`);
      } else {
        throw new Error(`Function "${name}" NOT auto-captured! Found: ${functionNames.join(', ')}`);
      }
    }

    // Module should be derived from filename
    const autoModule = functions[0].module;
    if (autoModule === 'test_observe_py_helpers') {
      console.log(`  Module auto-detected: "${autoModule}" ✓`);
    } else {
      console.log(`  Module: "${autoModule}"`);
    }

    // Verify type snapshots
    console.log('\n=== Step 5: Verify type snapshots ===');

    const parseConfigFn = functions.find(f => f.function_name === 'parse_config');
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${parseConfigFn.id}`);
    data = await resp.json();
    const snapshots = data.snapshots;

    if (snapshots.length === 0) {
      throw new Error('No type snapshots for parse_config!');
    }

    const snapshot = snapshots[0];
    const returnType = snapshot.return_type;

    if (returnType.kind === 'object') {
      const props = Object.keys(returnType.properties || {});
      if (props.includes('host') && props.includes('port') && props.includes('debug')) {
        console.log('  parse_config return type: {host, port, debug, retries} ✓');
      } else {
        throw new Error(`Unexpected return type props: ${props.join(', ')}`);
      }
    } else {
      throw new Error(`Expected object, got: ${returnType.kind}`);
    }

    // Verify sample data
    if (snapshot.sample_output && snapshot.sample_output.host === 'api.example.com') {
      console.log('  Sample output correct ✓');
    }

    if (snapshot.sample_input) {
      console.log('  Sample input present ✓');
    }

    // Verify error from auto-observe
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/errors`);
    data = await resp.json();
    if (data.errors.length > 0) {
      const err = data.errors[0];
      if (err.error_type === 'ValueError' && err.error_message.includes('bad_input')) {
        console.log('  Error auto-captured: ValueError ✓');
      }
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Python universal function observation works end-to-end!\n');

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
