/**
 * E2E test: Zero-code auto-instrumentation via `node -r trickle/register`
 *
 * Verifies that a plain Express app (with NO trickle imports) gets
 * auto-instrumented when started with the -r flag.
 *
 * Steps:
 * 1. Starts the trickle backend
 * 2. Starts test-register-app.js with `-r ./packages/client-js/register.js`
 * 3. Makes HTTP requests to the app
 * 4. Verifies types were captured in the backend
 * 5. Generates a typed API client and validates it compiles
 */
const { spawn, execSync } = require('child_process');
const path = require('path');

const BACKEND_PORT = 4888;
const APP_PORT = 3458;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch(`http://localhost:${port}`);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

async function run() {
  let backendProc = null;
  let appProc = null;

  try {
    // Step 1: Start the backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[backend-err] ${d}`);
    });

    await waitForServer(BACKEND_PORT);
    console.log('  Backend running on :' + BACKEND_PORT + ' ✓');

    // Step 2: Start the app with -r trickle/register (NO trickle code in the app!)
    console.log('\n=== Step 2: Start Express app with -r trickle/register ===');
    appProc = spawn('node', [
      '-r', '../packages/client-js/register.js',
      'test-register-app.js',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TRICKLE_BACKEND_URL: `http://localhost:${BACKEND_PORT}`,
        TRICKLE_DEBUG: '1',
      },
    });

    let appOutput = '';
    appProc.stdout.on('data', (d) => {
      appOutput += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[app] ${d}`);
    });
    appProc.stderr.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[app-err] ${d}`);
    });

    // Wait for app to be ready
    await waitForServer(APP_PORT);
    console.log('  Express app running on :' + APP_PORT + ' (zero trickle code!) ✓');

    // Verify auto-instrumentation message appeared
    await sleep(500);
    if (appOutput.includes('Auto-instrumented Express app')) {
      console.log('  Auto-instrumentation detected ✓');
    } else {
      console.log('  (Auto-instrumentation message may appear in stderr)');
    }

    // Step 3: Make requests to the auto-instrumented app
    console.log('\n=== Step 3: Make API requests ===');

    let resp = await fetch(`http://localhost:${APP_PORT}/api/products`);
    let body = await resp.json();
    console.log(`  GET /api/products → ${resp.status}, ${body.count} products ✓`);

    resp = await fetch(`http://localhost:${APP_PORT}/api/products/1`);
    body = await resp.json();
    console.log(`  GET /api/products/1 → ${resp.status}, ${body.name} ✓`);

    resp = await fetch(`http://localhost:${APP_PORT}/api/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 1, quantity: 3 }),
    });
    body = await resp.json();
    console.log(`  POST /api/cart → ${resp.status}, ${body.cartId} ✓`);

    // Wait for types to be flushed to backend
    console.log('\n=== Step 4: Wait for type observations to flush ===');
    await sleep(4000); // wait for batch interval + transport

    // Step 5: Query the backend for captured functions
    console.log('\n=== Step 5: Verify types captured in backend ===');
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    const functionsData = await resp.json();
    const functions = functionsData.functions;

    console.log(`  Functions observed: ${functions.length}`);
    if (functions.length === 0) {
      throw new Error('No functions captured! Auto-instrumentation may not be working.');
    }

    const functionNames = functions.map(f => f.function_name);
    console.log(`  Function names: ${functionNames.join(', ')}`);

    const expectedRoutes = ['GET /api/products', 'GET /api/products/:id', 'POST /api/cart'];
    for (const route of expectedRoutes) {
      if (functionNames.includes(route)) {
        console.log(`  Route "${route}" captured ✓`);
      } else {
        throw new Error(`Route "${route}" NOT captured! Found: ${functionNames.join(', ')}`);
      }
    }

    // Step 6: Generate typed client and verify it compiles
    console.log('\n=== Step 6: Generate typed API client ===');
    const clientPath = path.join(__dirname, '.trickle', 'register-test-client.ts');
    execSync(`npx trickle codegen --client --out ${clientPath}`, { stdio: 'pipe' });

    const clientCode = require('fs').readFileSync(clientPath, 'utf-8');
    const interfaceCount = (clientCode.match(/export interface/g) || []).length;
    const methodCount = (clientCode.match(/\w+: \(/g) || []).length;
    console.log(`  Generated: ${interfaceCount} interfaces, ${methodCount} client methods ✓`);

    // Validate TypeScript compilation
    try {
      execSync(`npx tsc --noEmit --strict ${clientPath}`, { stdio: 'pipe' });
      console.log('  tsc --strict: PASS ✓');
    } catch (err) {
      console.error('  tsc --strict: FAIL ✗');
      console.error(err.stdout?.toString() || err.stderr?.toString());
      process.exit(1);
    }

    // Verify key interfaces exist
    const expectedInterfaces = ['GetApiProductsOutput', 'PostApiCartInput', 'PostApiCartOutput'];
    for (const name of expectedInterfaces) {
      if (clientCode.includes(`interface ${name}`)) {
        console.log(`  Interface ${name} ✓`);
      } else {
        throw new Error(`Interface ${name} MISSING in generated client`);
      }
    }

    // Verify client methods
    if (clientCode.includes('getApiProducts:') && clientCode.includes('postApiCart:')) {
      console.log('  Client methods: getApiProducts, postApiCart ✓');
    } else {
      throw new Error('Client methods missing');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Zero-code auto-instrumentation works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    // Clean up
    if (appProc) {
      appProc.kill('SIGTERM');
      await sleep(500);
    }
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(500);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
