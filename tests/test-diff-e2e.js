/**
 * E2E test: `trickle diff` — cross-function type drift report
 *
 * Tests:
 * 1. Start backend, instrument an Express app, send requests to populate types
 * 2. Modify the response shape and send more requests → creates a second snapshot
 * 3. Run `trickle diff` and verify it detects type changes
 * 4. Run `trickle diff --since 1h` and verify it filters by time
 * 5. Test cross-env diff with --env1 / --env2
 * 6. Verify the backend API returns correct JSON structure
 */
const { spawn, execSync } = require('child_process');
const express = require('express');
const { instrument, configure, flush } = require('../packages/client-js/dist/index');

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

async function run() {
  let backendProc = null;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    execSync('rm -f ~/.trickle/trickle.db');
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(4888);
    console.log('  Backend running ✓');

    // Step 2: Populate initial types (version 1 of the API)
    console.log('\n=== Step 2: Populate initial type observations ===');
    configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });

    const app = express();
    app.use(express.json());
    instrument(app);

    // Version 1: products have name and price
    app.get('/api/products', (req, res) => {
      if (req.query.v === '2') {
        // Version 2: products have title, price, and rating (breaking change)
        res.json({
          products: [
            { id: 1, title: 'Widget', price: 29.99, rating: 4.5, inStock: true },
            { id: 2, title: 'Gadget', price: 49.99, rating: 3.8, inStock: false },
          ],
          total: 2,
          page: 1,
          hasMore: false,
        });
      } else {
        res.json({
          products: [
            { id: 1, name: 'Widget', price: 29.99 },
            { id: 2, name: 'Gadget', price: 49.99 },
          ],
          total: 2,
          page: 1,
        });
      }
    });

    app.get('/api/users', (req, res) => {
      if (req.query.v === '2') {
        // Version 2: users now have roles array
        res.json({
          users: [
            { id: 1, email: 'alice@test.com', name: 'Alice', roles: ['admin', 'user'], verified: true },
          ],
        });
      } else {
        res.json({
          users: [
            { id: 1, email: 'alice@test.com', name: 'Alice' },
          ],
        });
      }
    });

    // This endpoint won't change — should NOT appear in drift report
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', uptime: 12345 });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(3462, () => resolve(s));
    });

    // Make v1 requests
    await fetch('http://localhost:3462/api/products');
    await fetch('http://localhost:3462/api/users');
    await fetch('http://localhost:3462/api/health');
    console.log('  V1 requests made ✓');

    await flush();
    await sleep(2000);
    await flush();
    console.log('  V1 types flushed ✓');

    // Step 3: Make v2 requests (different response shapes)
    console.log('\n=== Step 3: Make V2 requests (breaking changes) ===');
    await fetch('http://localhost:3462/api/products?v=2');
    await fetch('http://localhost:3462/api/users?v=2');
    await fetch('http://localhost:3462/api/health'); // unchanged
    console.log('  V2 requests made ✓');

    await flush();
    await sleep(2000);
    await flush();
    console.log('  V2 types flushed ✓');

    server.close();

    // Step 4: Test the backend API directly
    console.log('\n=== Step 4: Test backend /api/diff endpoint ===');
    let resp = await fetch('http://localhost:4888/api/diff');
    let body = await resp.json();

    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    if (body.mode !== 'temporal') throw new Error(`Expected mode=temporal, got ${body.mode}`);
    if (!Array.isArray(body.entries)) throw new Error('entries should be an array');
    console.log(`  GET /api/diff → 200, mode=${body.mode}, ${body.total} entries ✓`);

    // Should have entries for products and users (they changed), but NOT health (unchanged)
    if (body.total < 1) throw new Error(`Expected at least 1 drift entry, got ${body.total}`);
    console.log(`  ${body.total} function(s) with type drift ✓`);

    // Check structure of entries
    for (const entry of body.entries) {
      if (!entry.functionName) throw new Error('Entry missing functionName');
      if (!entry.from || !entry.to) throw new Error('Entry missing from/to');
      if (!Array.isArray(entry.diffs)) throw new Error('Entry missing diffs array');
      if (entry.diffs.length === 0) throw new Error('Entry has empty diffs (should have been filtered)');
      console.log(`  ${entry.functionName}: ${entry.diffs.length} diff(s) ✓`);
    }

    // Verify health endpoint is NOT in drift report
    const healthEntry = body.entries.find(e => e.functionName.includes('health'));
    if (healthEntry) throw new Error('/api/health should not appear in drift (unchanged)');
    console.log('  /api/health correctly excluded (no changes) ✓');

    // Step 5: Test --since filter via API
    console.log('\n=== Step 5: Test --since filter ===');
    // Use a time in the far future — should return 0 entries
    resp = await fetch('http://localhost:4888/api/diff?since=2099-01-01%2000:00:00');
    body = await resp.json();
    if (body.total !== 0) throw new Error(`Expected 0 entries with future since, got ${body.total}`);
    console.log('  since=future → 0 entries ✓');

    // Use a time in the past — should return entries
    resp = await fetch('http://localhost:4888/api/diff?since=2000-01-01%2000:00:00');
    body = await resp.json();
    if (body.total < 1) throw new Error(`Expected entries with past since, got ${body.total}`);
    console.log(`  since=past → ${body.total} entries ✓`);

    // Step 6: Test CLI `trickle diff`
    console.log('\n=== Step 6: Test CLI `trickle diff` ===');
    let cliOutput = execSync('npx trickle diff', { encoding: 'utf-8' });
    if (!cliOutput.includes('Type drift')) throw new Error('CLI output missing "Type drift" header');
    console.log('  `trickle diff` output contains header ✓');

    // Should mention at least one function with changes
    if (!cliOutput.includes('products') && !cliOutput.includes('users')) {
      throw new Error('CLI output should mention changed functions');
    }
    console.log('  CLI output mentions changed functions ✓');

    // Test --since with CLI
    cliOutput = execSync('npx trickle diff --since 1h', { encoding: 'utf-8' });
    if (!cliOutput.includes('Type drift')) throw new Error('CLI --since output missing header');
    console.log('  `trickle diff --since 1h` works ✓');

    // Step 7: Test cross-env diff (populate a second env)
    console.log('\n=== Step 7: Test cross-env diff ===');

    // Reconfigure for "staging" env and send different types
    configure({
      backendUrl: 'http://localhost:4888',
      batchIntervalMs: 500,
      debug: false,
      environment: 'staging',
    });

    const app2 = express();
    app2.use(express.json());
    instrument(app2);

    // Staging version: products have different shape
    app2.get('/api/products', (req, res) => {
      res.json({
        products: [
          { id: 1, name: 'Widget', price: 29.99, discount: 0.1 },
        ],
        total: 1,
        page: 1,
        currency: 'USD',
      });
    });

    const server2 = await new Promise((resolve) => {
      const s = app2.listen(3463, () => resolve(s));
    });

    await fetch('http://localhost:3463/api/products');
    await flush();
    await sleep(2000);
    await flush();
    server2.close();
    console.log('  Staging types populated ✓');

    // Test cross-env via API
    resp = await fetch('http://localhost:4888/api/diff?env1=development&env2=staging');
    body = await resp.json();
    if (body.mode !== 'cross-env') throw new Error(`Expected mode=cross-env, got ${body.mode}`);
    console.log(`  Cross-env API: mode=${body.mode}, ${body.total} entries ✓`);

    // Test cross-env via CLI
    cliOutput = execSync('npx trickle diff --env1 development --env2 staging', { encoding: 'utf-8' });
    if (!cliOutput.includes('Type drift')) throw new Error('CLI cross-env output missing header');
    console.log('  `trickle diff --env1 development --env2 staging` works ✓');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle diff correctly reports type drift across functions!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
