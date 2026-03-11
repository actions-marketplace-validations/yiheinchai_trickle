/**
 * E2E test: `trickle check` — Breaking change detection
 *
 * Tests:
 * 1. Start backend, populate v1 types, save baseline
 * 2. Verify baseline file structure
 * 3. Check with no changes → exit 0 (PASS)
 * 4. Populate v2 (breaking changes), check → exit 1 (FAIL)
 * 5. Populate v3 (non-breaking only), check → exit 0 (PASS)
 * 6. Populate v4 (route removed), check → exit 1 (FAIL)
 * 7. Test usage display
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch(`http://localhost:${port}/api/health`).catch(() =>
        fetch(`http://localhost:${port}`)
      );
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

function runCli(args, expectFail = false) {
  try {
    const output = execSync(`npx trickle ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) {
      throw new Error(`Expected command to fail but it succeeded: trickle ${args}`);
    }
    return { output, exitCode: 0 };
  } catch (err) {
    if (expectFail) {
      return { output: (err.stdout || '') + (err.stderr || ''), exitCode: err.status || 1 };
    }
    throw err;
  }
}

/**
 * Write a temp script and run it as a child process.
 * This avoids module state pollution between versions.
 */
function runPopulate(port, scriptBody) {
  const tmpScript = path.join(__dirname, `.test-check-populate-${port}.js`);
  fs.writeFileSync(tmpScript, scriptBody, 'utf-8');
  try {
    execSync(`node ${tmpScript}`, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
  } finally {
    fs.unlinkSync(tmpScript);
  }
}

async function startBackend() {
  execSync('rm -f ~/.trickle/trickle.db');
  const proc = spawn('node', ['packages/backend/dist/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  await waitForServer(4888);
  return proc;
}

async function run() {
  let backendProc = null;
  const baselineFile = path.join(__dirname, '.test-check-baseline.json');

  try {
    // Step 1: Populate v1 and save baseline
    console.log('=== Step 1: Populate v1 types and save baseline ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    runPopulate(3465, `
      const express = require('express');
      const { instrument, configure, flush } = require('./packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });
      const app = express();
      app.use(express.json());
      instrument(app);
      app.get('/api/users', (req, res) => res.json({
        users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }, { id: 2, name: 'Bob', email: 'bob@test.com' }],
        total: 2,
      }));
      app.post('/api/users', (req, res) => res.json({ id: 3, name: req.body.name, email: req.body.email }));
      app.get('/api/products', (req, res) => res.json({ products: [{ id: 1, title: 'Widget', price: 29.99 }], count: 1 }));
      const s = app.listen(3465, async () => {
        await fetch('http://localhost:3465/api/users');
        await fetch('http://localhost:3465/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:'C',email:'c@t.com'}) });
        await fetch('http://localhost:3465/api/products');
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  V1 types populated ✓');

    runCli(`check --save ${baselineFile}`);
    console.log('  Baseline saved ✓');

    // Step 2: Verify baseline structure
    console.log('\n=== Step 2: Verify baseline structure ===');
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
    if (baseline.version !== 1) throw new Error(`Expected version 1, got ${baseline.version}`);
    if (!Array.isArray(baseline.functions)) throw new Error('Missing functions array');
    if (baseline.functions.length < 3) throw new Error(`Expected >=3 functions, got ${baseline.functions.length}`);
    for (const fn of baseline.functions) {
      if (!fn.name || !fn.argsType || !fn.returnType) throw new Error(`Invalid function: ${fn.name}`);
      console.log(`    ${fn.name} ✓`);
    }
    console.log(`  ${baseline.functions.length} functions in baseline ✓`);

    // Step 3: No changes → PASS
    console.log('\n=== Step 3: Check with no changes (should pass) ===');
    const { output: passOutput } = runCli(`check --against ${baselineFile}`);
    if (!passOutput.includes('No type changes') && !passOutput.includes('PASS')) {
      throw new Error('Expected PASS');
    }
    console.log('  No changes → PASS ✓');

    // Step 4: Breaking changes
    console.log('\n=== Step 4: Breaking changes (remove field, change type) ===');
    backendProc.kill('SIGTERM');
    await sleep(500);
    backendProc = await startBackend();

    runPopulate(3466, `
      const express = require('express');
      const { instrument, configure, flush } = require('./packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });
      const app = express();
      app.use(express.json());
      instrument(app);
      // Breaking: "name" changed to number, "email" removed
      app.get('/api/users', (req, res) => res.json({
        users: [{ id: 1, name: 42 }, { id: 2, name: 99 }],
        total: 2,
      }));
      // Breaking: "email" removed from response
      app.post('/api/users', (req, res) => res.json({ id: 3, name: req.body.name }));
      app.get('/api/products', (req, res) => res.json({ products: [{ id: 1, title: 'Widget', price: 29.99 }], count: 1 }));
      const s = app.listen(3466, async () => {
        await fetch('http://localhost:3466/api/users');
        await fetch('http://localhost:3466/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:'C',email:'c@t.com'}) });
        await fetch('http://localhost:3466/api/products');
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  V2 (breaking) populated ✓');

    const { output: failOutput, exitCode } = runCli(`check --against ${baselineFile}`, true);
    if (exitCode !== 1) throw new Error(`Expected exit code 1, got ${exitCode}`);
    if (!failOutput.includes('BREAKING') && !failOutput.includes('FAIL')) {
      throw new Error('Expected BREAKING or FAIL in output');
    }
    console.log('  Breaking changes → exit code 1 ✓');
    if (failOutput.includes('removed') || failOutput.includes('changed')) {
      console.log('  Specific breaking changes reported ✓');
    }

    // Step 5: Non-breaking only
    console.log('\n=== Step 5: Non-breaking changes only (add field) ===');
    backendProc.kill('SIGTERM');
    await sleep(500);
    backendProc = await startBackend();

    runPopulate(3467, `
      const express = require('express');
      const { instrument, configure, flush } = require('./packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });
      const app = express();
      app.use(express.json());
      instrument(app);
      // Non-breaking: added "role" and "hasMore"
      app.get('/api/users', (req, res) => res.json({
        users: [{ id: 1, name: 'Alice', email: 'alice@test.com', role: 'admin' }],
        total: 1,
        hasMore: false,
      }));
      app.post('/api/users', (req, res) => res.json({ id: 3, name: req.body.name, email: req.body.email }));
      app.get('/api/products', (req, res) => res.json({ products: [{ id: 1, title: 'Widget', price: 29.99 }], count: 1 }));
      const s = app.listen(3467, async () => {
        await fetch('http://localhost:3467/api/users');
        await fetch('http://localhost:3467/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:'C',email:'c@t.com'}) });
        await fetch('http://localhost:3467/api/products');
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  V3 (non-breaking) populated ✓');

    const { output: nbOutput } = runCli(`check --against ${baselineFile}`);
    if (!nbOutput.includes('PASS')) {
      throw new Error('Expected PASS for non-breaking changes. Got: ' + nbOutput);
    }
    if (!nbOutput.includes('non-breaking')) {
      throw new Error('Expected "non-breaking" in output');
    }
    console.log('  Non-breaking only → PASS ✓');

    // Step 6: Route removed
    console.log('\n=== Step 6: Route removed (should fail) ===');
    backendProc.kill('SIGTERM');
    await sleep(500);
    backendProc = await startBackend();

    runPopulate(3468, `
      const express = require('express');
      const { instrument, configure, flush } = require('./packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });
      const app = express();
      app.use(express.json());
      instrument(app);
      app.get('/api/users', (req, res) => res.json({
        users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
        total: 1,
      }));
      app.post('/api/users', (req, res) => res.json({ id: 3, name: req.body.name, email: req.body.email }));
      // /api/products removed!
      const s = app.listen(3468, async () => {
        await fetch('http://localhost:3468/api/users');
        await fetch('http://localhost:3468/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:'C',email:'c@t.com'}) });
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  V4 (route removed) populated ✓');

    const { output: rmOutput, exitCode: rmExit } = runCli(`check --against ${baselineFile}`, true);
    if (rmExit !== 1) throw new Error(`Expected exit code 1, got ${rmExit}`);
    if (!rmOutput.includes('removed')) {
      throw new Error('Expected "removed" in output');
    }
    console.log('  Route removed → exit code 1 ✓');

    // Step 7: Usage display
    console.log('\n=== Step 7: Test usage display ===');
    const { output: usageOutput } = runCli('check');
    if (!usageOutput.includes('--save') || !usageOutput.includes('--against')) {
      throw new Error('Usage should mention --save and --against');
    }
    console.log('  Usage display ✓');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle check correctly detects breaking vs non-breaking API changes!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (fs.existsSync(baselineFile)) fs.unlinkSync(baselineFile);
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
