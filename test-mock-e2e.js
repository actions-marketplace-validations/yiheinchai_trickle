/**
 * E2E test: Mock server from runtime-observed types
 *
 * Steps:
 * 1. Start trickle backend
 * 2. Start an instrumented Express app, make requests to populate types
 * 3. Start `trickle mock` server
 * 4. Make requests to the mock server and verify responses match observed shapes
 * 5. Verify path param substitution works
 * 6. Verify 404 for unknown routes
 */
const { spawn, execSync } = require('child_process');
const express = require('express');
const { instrument, configure, flush } = require('./packages/client-js/dist/index');

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
  let mockProc = null;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    execSync('rm -f ~/.trickle/trickle.db');
    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(4888);
    console.log('  Backend running ✓');

    // Step 2: Instrument and populate types
    console.log('\n=== Step 2: Populate type observations ===');
    configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });

    const app = express();
    app.use(express.json());
    instrument(app);

    app.get('/api/products', (req, res) => {
      res.json({
        products: [
          { id: 1, name: 'Widget', price: 29.99, category: 'electronics' },
          { id: 2, name: 'Gadget', price: 49.99, category: 'accessories' },
          { id: 3, name: 'Doohickey', price: 19.99, category: 'misc' },
        ],
        total: 3,
        page: 1,
      });
    });

    app.get('/api/products/:id', (req, res) => {
      res.json({
        id: parseInt(req.params.id),
        name: 'Widget',
        price: 29.99,
        category: 'electronics',
        description: 'A fine widget for all your widgeting needs',
        reviews: [
          { rating: 5, comment: 'Excellent widget!' },
          { rating: 4, comment: 'Pretty good widget.' },
        ],
      });
    });

    app.post('/api/cart/add', (req, res) => {
      const { productId, quantity } = req.body;
      res.json({
        cartId: 'CART-12345',
        items: [{ productId, quantity, price: 29.99 }],
        subtotal: 29.99 * quantity,
      });
    });

    app.delete('/api/cart/:cartId', (req, res) => {
      res.json({ deleted: true, cartId: req.params.cartId });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(3459, () => resolve(s));
    });

    // Make requests
    await fetch('http://localhost:3459/api/products');
    console.log('  GET /api/products ✓');
    await fetch('http://localhost:3459/api/products/1');
    console.log('  GET /api/products/1 ✓');
    await fetch('http://localhost:3459/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 1, quantity: 2 }),
    });
    console.log('  POST /api/cart/add ✓');
    await fetch('http://localhost:3459/api/cart/CART-999', { method: 'DELETE' });
    console.log('  DELETE /api/cart/CART-999 ✓');

    // Flush and wait
    await flush();
    await sleep(1500);
    await flush();
    server.close();
    console.log('  Types flushed to backend ✓');

    // Step 3: Start mock server
    console.log('\n=== Step 3: Start mock server ===');
    mockProc = spawn('npx', ['trickle', 'mock', '--port', '3460'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let mockOutput = '';
    mockProc.stdout.on('data', (d) => { mockOutput += d.toString(); });
    mockProc.stderr.on('data', (d) => { mockOutput += d.toString(); });

    // Wait for mock server to start
    await waitForServer(3460);
    await sleep(500);
    console.log('  Mock server running on :3460 ✓');

    // Step 4: Test mock server responses
    console.log('\n=== Step 4: Test mock server responses ===');

    // Test GET /api/products
    let resp = await fetch('http://localhost:3460/api/products');
    let body = await resp.json();
    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    if (!body.products || !Array.isArray(body.products)) throw new Error('products should be an array');
    if (typeof body.total !== 'number') throw new Error('total should be a number');
    console.log(`  GET /api/products → 200, ${body.products.length} products, total=${body.total} ✓`);

    // Test GET /api/products/:id with path param substitution
    resp = await fetch('http://localhost:3460/api/products/42');
    body = await resp.json();
    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    if (body.id !== 42) throw new Error(`Expected id=42, got id=${body.id} (path param substitution)`);
    if (typeof body.name !== 'string') throw new Error('name should be a string');
    if (typeof body.price !== 'number') throw new Error('price should be a number');
    console.log(`  GET /api/products/42 → 200, id=${body.id}, name="${body.name}" ✓`);

    // Test POST /api/cart/add
    resp = await fetch('http://localhost:3460/api/cart/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 5, quantity: 3 }),
    });
    body = await resp.json();
    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    if (!body.cartId) throw new Error('cartId should exist');
    if (!body.items || !Array.isArray(body.items)) throw new Error('items should be an array');
    console.log(`  POST /api/cart/add → 200, cartId="${body.cartId}" ✓`);

    // Test DELETE /api/cart/:cartId with param substitution
    resp = await fetch('http://localhost:3460/api/cart/CART-ABC', { method: 'DELETE' });
    body = await resp.json();
    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    if (body.cartId !== 'CART-ABC') throw new Error(`Expected cartId=CART-ABC, got ${body.cartId}`);
    if (body.deleted !== true) throw new Error('deleted should be true');
    console.log(`  DELETE /api/cart/CART-ABC → 200, cartId="${body.cartId}", deleted=${body.deleted} ✓`);

    // Step 5: Test 404 for unknown route
    console.log('\n=== Step 5: Test 404 for unknown routes ===');
    resp = await fetch('http://localhost:3460/api/nonexistent');
    body = await resp.json();
    if (resp.status !== 404) throw new Error(`Expected 404, got ${resp.status}`);
    console.log(`  GET /api/nonexistent → 404 ✓`);

    // Step 6: Test CORS headers
    console.log('\n=== Step 6: Test CORS headers ===');
    resp = await fetch('http://localhost:3460/api/products', { method: 'OPTIONS' });
    if (resp.status !== 204) throw new Error(`Expected 204 for OPTIONS, got ${resp.status}`);
    const corsHeader = resp.headers.get('access-control-allow-origin');
    if (corsHeader !== '*') throw new Error(`Expected CORS header *, got ${corsHeader}`);
    console.log(`  OPTIONS /api/products → 204, CORS: * ✓`);

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Mock server correctly serves observed runtime types!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (mockProc) {
      mockProc.kill('SIGTERM');
      await sleep(300);
    }
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
