/**
 * E2E test: `trickle codegen --handlers` — Express handler type generation
 *
 * Tests:
 * 1. Start backend, populate routes with Express app
 * 2. Generate handler types via CLI
 * 3. Verify output contains typed handler aliases
 * 4. Verify Request generic params (Params, ResBody, ReqBody, Query)
 * 5. Verify path params generate interface
 * 6. Verify POST handlers include ReqBody
 * 7. Test --out flag writes to file
 * 8. Verify Express import statement
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

function runCli(args) {
  const output = execSync(`npx trickle ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return output;
}

function runPopulate(port, scriptBody) {
  const tmpScript = path.join(__dirname, `.test-handlers-populate-${port}.js`);
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
  const outFile = path.join(__dirname, '.test-handlers-output.ts');

  try {
    // Step 1: Populate routes
    console.log('=== Step 1: Start backend and populate routes ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    runPopulate(3473, `
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

      app.post('/api/users', (req, res) => res.json({
        id: 2, name: req.body.name, email: req.body.email, created: true,
      }));

      app.get('/api/users/:id', (req, res) => res.json({
        id: parseInt(req.params.id), name: 'Alice', email: 'alice@test.com',
      }));

      app.put('/api/users/:id', (req, res) => res.json({
        id: parseInt(req.params.id), name: req.body.name, email: req.body.email, updated: true,
      }));

      app.get('/api/products', (req, res) => res.json({
        products: [{ id: 1, title: 'Widget', price: 29.99, inStock: true }],
        count: 1,
      }));

      const s = app.listen(3473, async () => {
        await fetch('http://localhost:3473/api/users');
        await fetch('http://localhost:3473/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Bob', email: 'bob@test.com' }),
        });
        await fetch('http://localhost:3473/api/users/1');
        await fetch('http://localhost:3473/api/users/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Alice Updated', email: 'alice2@test.com' }),
        });
        await fetch('http://localhost:3473/api/products');
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  Routes populated ✓');

    // Step 2: Generate handler types
    console.log('\n=== Step 2: Generate handler types ===');
    const output = runCli('codegen --handlers');
    if (!output.includes('Handler')) {
      throw new Error('Output should contain Handler type aliases');
    }
    console.log('  Handler types generated ✓');

    // Step 3: Verify Express import
    console.log('\n=== Step 3: Verify Express import ===');
    if (!output.includes('import { Request, Response, NextFunction } from "express"')) {
      throw new Error('Output should import Request, Response, NextFunction from express');
    }
    console.log('  Express import present ✓');

    // Step 4: Verify handler type aliases exist
    console.log('\n=== Step 4: Verify handler type aliases ===');
    const handlerMatches = output.match(/export type \w+Handler = /g) || [];
    console.log(`  Found ${handlerMatches.length} handler types`);
    if (handlerMatches.length < 3) {
      throw new Error(`Expected at least 3 handler types, got ${handlerMatches.length}`);
    }
    console.log('  Multiple handler types ✓');

    // Step 5: Verify Request generic params
    console.log('\n=== Step 5: Verify Request generic params ===');
    // GET handlers should have Request<Params, ResBody, unknown, Query>
    if (!output.includes('req: Request<')) {
      throw new Error('Handler types should use Request<> generic');
    }
    if (!output.includes('res: Response<')) {
      throw new Error('Handler types should use Response<> generic');
    }
    if (!output.includes('next: NextFunction')) {
      throw new Error('Handler types should include NextFunction');
    }
    console.log('  Request/Response/NextFunction generics ✓');

    // Step 6: Verify ResBody interface
    console.log('\n=== Step 6: Verify ResBody interfaces ===');
    if (!output.includes('ResBody')) {
      throw new Error('Should have ResBody interfaces');
    }
    // Check that response body interfaces contain the right fields
    if (!output.includes('users') && !output.includes('total')) {
      throw new Error('ResBody should contain response fields like users/total');
    }
    console.log('  ResBody interfaces with correct fields ✓');

    // Step 7: Verify POST/PUT handlers have ReqBody
    console.log('\n=== Step 7: Verify POST/PUT handlers have ReqBody ===');
    if (!output.includes('ReqBody')) {
      throw new Error('POST/PUT handlers should have ReqBody interfaces');
    }
    console.log('  ReqBody for POST/PUT ✓');

    // Step 8: Verify path params generate interfaces
    console.log('\n=== Step 8: Verify path params ===');
    if (!output.includes('Params')) {
      throw new Error('Routes with :id should generate Params interfaces');
    }
    console.log('  Params interfaces for parameterized routes ✓');

    // Step 9: Test --out flag
    console.log('\n=== Step 9: Test --out flag ===');
    runCli(`codegen --handlers --out ${outFile}`);
    if (!fs.existsSync(outFile)) {
      throw new Error('--out flag should write to file');
    }
    const fileContent = fs.readFileSync(outFile, 'utf-8');
    if (!fileContent.includes('Handler')) {
      throw new Error('Written file should contain handler types');
    }
    console.log('  --out flag writes file ✓');

    // Step 10: Verify auto-generated header
    console.log('\n=== Step 10: Verify auto-generated header ===');
    if (!output.includes('Auto-generated Express handler types by trickle')) {
      throw new Error('Should have auto-generated header');
    }
    if (!output.includes('trickle codegen --handlers')) {
      throw new Error('Header should reference --handlers flag');
    }
    console.log('  Auto-generated header ✓');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --handlers correctly generates typed Express handler types!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
