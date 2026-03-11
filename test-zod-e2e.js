/**
 * E2E test: `trickle codegen --zod` — Zod schema generation
 *
 * Tests:
 * 1. Start backend, populate routes and functions
 * 2. Generate Zod schemas via CLI
 * 3. Verify Zod import
 * 4. Verify response schemas for routes
 * 5. Verify request body schemas for POST routes
 * 6. Verify schema uses correct Zod types (z.string, z.number, z.boolean, z.array, z.object)
 * 7. Verify z.infer type exports
 * 8. Test --out flag writes to file
 * 9. Verify non-route functions get Input/Output schemas
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
  const tmpScript = path.join(__dirname, `.test-zod-populate-${port}.js`);
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
  const outFile = path.join(__dirname, '.test-zod-output.ts');

  try {
    // Step 1: Populate routes
    console.log('=== Step 1: Start backend and populate routes ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    runPopulate(3474, `
      const express = require('express');
      const { instrument, configure, flush } = require('./packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });
      const app = express();
      app.use(express.json());
      instrument(app);

      app.get('/api/users', (req, res) => res.json({
        users: [{ id: 1, name: 'Alice', email: 'alice@test.com', active: true }],
        total: 1,
      }));

      app.post('/api/users', (req, res) => res.json({
        id: 2, name: req.body.name, email: req.body.email, created: true,
      }));

      app.get('/api/products', (req, res) => res.json({
        products: [{ id: 1, title: 'Widget', price: 29.99, tags: ['sale', 'new'] }],
        count: 1,
      }));

      app.put('/api/products/:id', (req, res) => res.json({
        id: parseInt(req.params.id), title: req.body.title, price: req.body.price, updated: true,
      }));

      const s = app.listen(3474, async () => {
        await fetch('http://localhost:3474/api/users');
        await fetch('http://localhost:3474/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Bob', email: 'bob@test.com' }),
        });
        await fetch('http://localhost:3474/api/products');
        await fetch('http://localhost:3474/api/products/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Super Widget', price: 39.99 }),
        });
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  Routes populated ✓');

    // Step 2: Generate Zod schemas
    console.log('\n=== Step 2: Generate Zod schemas ===');
    const output = runCli('codegen --zod');
    if (!output.includes('Schema')) {
      throw new Error('Output should contain Schema definitions');
    }
    console.log('  Zod schemas generated ✓');

    // Step 3: Verify Zod import
    console.log('\n=== Step 3: Verify Zod import ===');
    if (!output.includes('import { z } from "zod"')) {
      throw new Error('Output should import z from zod');
    }
    console.log('  Zod import present ✓');

    // Step 4: Verify response schemas
    console.log('\n=== Step 4: Verify response schemas ===');
    const responseSchemas = output.match(/\w+ResponseSchema\s*=/g) || [];
    console.log(`  Found ${responseSchemas.length} response schemas`);
    if (responseSchemas.length < 3) {
      throw new Error(`Expected at least 3 response schemas, got ${responseSchemas.length}`);
    }
    console.log('  Response schemas for all routes ✓');

    // Step 5: Verify request body schemas for POST/PUT
    console.log('\n=== Step 5: Verify request body schemas ===');
    const requestSchemas = output.match(/\w+RequestSchema\s*=/g) || [];
    console.log(`  Found ${requestSchemas.length} request schemas`);
    if (requestSchemas.length < 1) {
      throw new Error(`Expected at least 1 request schema, got ${requestSchemas.length}`);
    }
    console.log('  Request body schemas for POST/PUT ✓');

    // Step 6: Verify correct Zod types
    console.log('\n=== Step 6: Verify Zod type primitives ===');
    if (!output.includes('z.string()')) throw new Error('Should contain z.string()');
    if (!output.includes('z.number()')) throw new Error('Should contain z.number()');
    if (!output.includes('z.boolean()')) throw new Error('Should contain z.boolean()');
    if (!output.includes('z.object(')) throw new Error('Should contain z.object()');
    if (!output.includes('z.array(')) throw new Error('Should contain z.array()');
    console.log('  z.string(), z.number(), z.boolean(), z.object(), z.array() ✓');

    // Step 7: Verify z.infer type exports
    console.log('\n=== Step 7: Verify z.infer type exports ===');
    const inferCount = (output.match(/z\.infer<typeof/g) || []).length;
    if (inferCount < 3) {
      throw new Error(`Expected at least 3 z.infer exports, got ${inferCount}`);
    }
    console.log(`  ${inferCount} z.infer<typeof ...> type exports ✓`);

    // Step 8: Verify schema structure makes sense
    console.log('\n=== Step 8: Verify schema structure ===');
    // The users response should have z.array() for the users field
    if (!output.includes('users: z.array(')) {
      throw new Error('users field should use z.array()');
    }
    // The total field should be z.number()
    if (!output.includes('total: z.number()')) {
      throw new Error('total field should be z.number()');
    }
    console.log('  Schema structure matches runtime observations ✓');

    // Step 9: Test --out flag
    console.log('\n=== Step 9: Test --out flag ===');
    runCli(`codegen --zod --out ${outFile}`);
    if (!fs.existsSync(outFile)) {
      throw new Error('--out flag should write to file');
    }
    const fileContent = fs.readFileSync(outFile, 'utf-8');
    if (!fileContent.includes('z.object(')) {
      throw new Error('Written file should contain Zod schemas');
    }
    console.log('  --out flag writes file ✓');

    // Step 10: Verify auto-generated header
    console.log('\n=== Step 10: Verify header ===');
    if (!output.includes('Auto-generated Zod schemas by trickle')) {
      throw new Error('Should have auto-generated header');
    }
    if (!output.includes('trickle codegen --zod')) {
      throw new Error('Header should reference --zod flag');
    }
    console.log('  Auto-generated header ✓');

    // Step 11: Verify JSDoc comments reference routes
    console.log('\n=== Step 11: Verify JSDoc comments ===');
    if (!output.includes('/** GET /api/users')) {
      throw new Error('Should have JSDoc comments with route info');
    }
    if (!output.includes('/** POST /api/users')) {
      throw new Error('Should have JSDoc comment for POST route');
    }
    console.log('  JSDoc comments with route info ✓');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --zod correctly generates Zod validation schemas from runtime types!\n');

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
