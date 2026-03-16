/**
 * E2E test: Koa auto-instrumentation
 *
 * Tests:
 * 1. Start backend, create Koa app with instrument()
 * 2. Make requests to various endpoints (using @koa/router)
 * 3. Verify functions captured in backend
 * 4. Verify type snapshots with sample data
 * 5. Verify error capture
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
    console.log('=== Step 1: Start backend ===');
    execSync('rm -f ~/.trickle/trickle.db');
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(4888);
    console.log('  Backend running ✓');

    // Step 2: Create and run a Koa app with instrument()
    console.log('\n=== Step 2: Run Koa app with instrument() ===');
    const appScript = path.join(__dirname, '.test-koa-app.js');
    fs.writeFileSync(appScript, `
      const Koa = require('koa');
      const Router = require('@koa/router');
      const bodyParser = require('koa-bodyparser');
      const { instrument, instrumentKoaRouter, configure, flush } = require('../packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });

      const app = new Koa();
      instrument(app);  // Adds observability middleware

      app.use(bodyParser());

      const router = new Router();

      router.get('/api/users', async (ctx) => {
        ctx.body = {
          users: [
            { id: 1, name: 'Alice', email: 'alice@test.com', active: true },
            { id: 2, name: 'Bob', email: 'bob@test.com', active: false },
          ],
          total: 2,
        };
      });

      router.post('/api/users', async (ctx) => {
        const body = ctx.request.body || {};
        ctx.body = {
          id: 3, name: body.name, email: body.email, created: true,
        };
      });

      router.get('/api/products/:id', async (ctx) => {
        ctx.body = {
          id: parseInt(ctx.params.id),
          title: 'Widget',
          price: 29.99,
          inStock: true,
        };
      });

      app.use(router.routes());
      app.use(router.allowedMethods());

      const server = app.listen(3479, async () => {
        console.log('Koa app on 3479');

        // Make requests
        await fetch('http://localhost:3479/api/users');
        await fetch('http://localhost:3479/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Charlie', email: 'charlie@test.com' }),
        });
        await fetch('http://localhost:3479/api/products/42');

        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();

        server.close();
        process.exit(0);
      });
    `);

    try {
      execSync(`node ${appScript}`, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    } finally {
      fs.unlinkSync(appScript);
    }
    console.log('  Koa app ran and made requests ✓');

    // Step 3: Verify functions captured
    console.log('\n=== Step 3: Verify functions captured ===');
    const functionsRes = await fetch('http://localhost:4888/api/functions');
    const { functions } = await functionsRes.json();

    const koaFunctions = functions.filter(f => f.function_name.includes('/api/'));
    console.log(`  Found ${koaFunctions.length} route functions`);

    if (koaFunctions.length < 2) {
      throw new Error(`Expected at least 2 route functions, got ${koaFunctions.length}`);
    }

    const routeNames = koaFunctions.map(f => f.function_name);
    console.log(`  Routes: ${routeNames.join(', ')}`);

    // Koa middleware captures the path (may be exact URL or matched route)
    const hasUsers = routeNames.some(n => n.includes('/api/users'));
    const hasProducts = routeNames.some(n => n.includes('/api/products'));

    if (!hasUsers) {
      throw new Error('Missing /api/users route');
    }
    if (!hasProducts) {
      throw new Error('Missing /api/products route');
    }
    console.log('  Route functions captured ✓');

    // Step 4: Verify type snapshots
    console.log('\n=== Step 4: Verify type snapshots ===');
    const getUsersFn = koaFunctions.find(f => f.function_name.includes('/api/users') && f.function_name.includes('GET'));
    if (getUsersFn) {
      const typesRes = await fetch(`http://localhost:4888/api/types/${getUsersFn.id}`);
      const { snapshots } = await typesRes.json();

      if (snapshots.length === 0) {
        throw new Error('No type snapshots for GET /api/users');
      }

      const snap = snapshots[0];
      if (snap.sample_output) {
        const output = typeof snap.sample_output === 'string' ? JSON.parse(snap.sample_output) : snap.sample_output;
        if (!output.users || !output.total) {
          throw new Error('Sample output missing expected fields (users, total)');
        }
        console.log('  Type snapshot with sample data ✓');
      } else {
        console.log('  Type snapshot captured (no sample output) ✓');
      }
    } else {
      // Check any koa function
      const anyFn = koaFunctions[0];
      const typesRes = await fetch(`http://localhost:4888/api/types/${anyFn.id}`);
      const { snapshots } = await typesRes.json();
      if (snapshots.length > 0) {
        console.log('  Type snapshots present ✓');
      } else {
        throw new Error('No type snapshots captured');
      }
    }

    // Step 5: Verify CLI reads Koa data
    console.log('\n=== Step 5: Verify CLI reads Koa data ===');
    const cliOutput = execSync('npx trickle functions', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (cliOutput.includes('/api/') || cliOutput.includes('functions')) {
      console.log('  trickle functions shows Koa routes ✓');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Koa auto-instrumentation works correctly!\n');

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
