/**
 * E2E test: `trickle codegen --react-query` — TanStack React Query hook generation
 *
 * Tests:
 * 1. Start backend, populate routes
 * 2. Generate React Query hooks via CLI
 * 3. Verify TanStack imports (useQuery, useMutation, useQueryClient)
 * 4. Verify useQuery hooks for GET routes
 * 5. Verify useMutation hooks for POST/PUT/DELETE routes
 * 6. Verify query key factory
 * 7. Verify response/input interfaces
 * 8. Verify configureTrickleHooks setup function
 * 9. Verify auto-invalidation in mutations
 * 10. Verify path params in hooks
 * 11. Test --out flag
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
  const tmpScript = path.join(__dirname, `.test-rq-populate-${port}.js`);
  fs.writeFileSync(tmpScript, scriptBody, 'utf-8');
  try {
    execSync(`node ${tmpScript}`, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
  } finally {
    fs.unlinkSync(tmpScript);
  }
}

async function startBackend() {
  execSync('rm -f ~/.trickle/trickle.db');
  const proc = spawn('node', ['../packages/backend/dist/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  await waitForServer(4888);
  return proc;
}

async function run() {
  let backendProc = null;
  const outFile = path.join(__dirname, '.test-rq-output.ts');

  try {
    // Step 1: Populate routes
    console.log('=== Step 1: Start backend and populate routes ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    runPopulate(3475, `
      const express = require('express');
      const { instrument, configure, flush } = require('../packages/client-js/dist/index');
      configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });
      const app = express();
      app.use(express.json());
      instrument(app);

      app.get('/api/users', (req, res) => res.json({
        users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }],
        total: 1,
      }));

      app.get('/api/users/:id', (req, res) => res.json({
        id: parseInt(req.params.id), name: 'Alice', email: 'alice@test.com',
      }));

      app.post('/api/users', (req, res) => res.json({
        id: 2, name: req.body.name, email: req.body.email, created: true,
      }));

      app.put('/api/users/:id', (req, res) => res.json({
        id: parseInt(req.params.id), name: req.body.name, updated: true,
      }));

      app.delete('/api/users/:id', (req, res) => res.json({
        deleted: true,
      }));

      app.get('/api/products', (req, res) => res.json({
        products: [{ id: 1, title: 'Widget', price: 29.99 }],
        count: 1,
      }));

      const s = app.listen(3475, async () => {
        await fetch('http://localhost:3475/api/users');
        await fetch('http://localhost:3475/api/users/1');
        await fetch('http://localhost:3475/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Bob', email: 'bob@test.com' }),
        });
        await fetch('http://localhost:3475/api/users/1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Alice Updated' }),
        });
        await fetch('http://localhost:3475/api/users/1', { method: 'DELETE' });
        await fetch('http://localhost:3475/api/products');
        await flush();
        await new Promise(r => setTimeout(r, 2000));
        await flush();
        s.close();
        process.exit(0);
      });
    `);
    console.log('  Routes populated ✓');

    // Step 2: Generate React Query hooks
    console.log('\n=== Step 2: Generate React Query hooks ===');
    const output = runCli('codegen --react-query');
    if (!output.includes('useQuery') && !output.includes('useMutation')) {
      throw new Error('Output should contain useQuery or useMutation');
    }
    console.log('  React Query hooks generated ✓');

    // Step 3: Verify TanStack imports
    console.log('\n=== Step 3: Verify TanStack imports ===');
    if (!output.includes('import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"')) {
      throw new Error('Should import useQuery, useMutation, useQueryClient');
    }
    if (!output.includes('UseQueryOptions')) {
      throw new Error('Should import UseQueryOptions type');
    }
    if (!output.includes('UseMutationOptions')) {
      throw new Error('Should import UseMutationOptions type');
    }
    console.log('  TanStack imports ✓');

    // Step 4: Verify useQuery hooks for GET routes
    console.log('\n=== Step 4: Verify useQuery hooks ===');
    const queryHooks = output.match(/export function use\w+\(/g) || [];
    console.log(`  Found ${queryHooks.length} hooks`);
    if (queryHooks.length < 4) {
      throw new Error(`Expected at least 4 hooks, got ${queryHooks.length}`);
    }
    // Specific GET hook
    if (!output.includes('useGetApiUsers(')) {
      throw new Error('Should have useGetApiUsers hook');
    }
    if (!output.includes('useGetApiProducts(')) {
      throw new Error('Should have useGetApiProducts hook');
    }
    console.log('  useQuery hooks for GET routes ✓');

    // Step 5: Verify useMutation hooks
    console.log('\n=== Step 5: Verify useMutation hooks ===');
    if (!output.includes('usePostApiUsers(')) {
      throw new Error('Should have usePostApiUsers hook');
    }
    if (!output.includes('useMutation(')) {
      throw new Error('Should use useMutation for POST/PUT/DELETE');
    }
    console.log('  useMutation hooks for POST/PUT/DELETE ✓');

    // Step 6: Verify query key factory
    console.log('\n=== Step 6: Verify query key factory ===');
    if (!output.includes('export const queryKeys = {')) {
      throw new Error('Should have queryKeys factory');
    }
    if (!output.includes('users:')) {
      throw new Error('Should have users key namespace');
    }
    if (!output.includes('products:')) {
      throw new Error('Should have products key namespace');
    }
    if (!output.includes('all:')) {
      throw new Error('Should have .all key');
    }
    console.log('  Query key factory with resource namespaces ✓');

    // Step 7: Verify response interfaces
    console.log('\n=== Step 7: Verify response interfaces ===');
    if (!output.includes('Response')) {
      throw new Error('Should have Response interfaces');
    }
    if (!output.includes('users') || !output.includes('total')) {
      throw new Error('Response interfaces should have correct fields');
    }
    console.log('  Response interfaces with correct fields ✓');

    // Step 8: Verify configureTrickleHooks
    console.log('\n=== Step 8: Verify configureTrickleHooks ===');
    if (!output.includes('export function configureTrickleHooks(baseUrl: string)')) {
      throw new Error('Should have configureTrickleHooks setup function');
    }
    console.log('  configureTrickleHooks setup function ✓');

    // Step 9: Verify auto-invalidation
    console.log('\n=== Step 9: Verify auto-invalidation in mutations ===');
    if (!output.includes('invalidateQueries')) {
      throw new Error('Mutations should auto-invalidate queries');
    }
    if (!output.includes('queryClient')) {
      throw new Error('Mutations should use queryClient');
    }
    console.log('  Auto-invalidation on mutation success ✓');

    // Step 10: Verify path params in hooks
    console.log('\n=== Step 10: Verify path params ===');
    if (!output.includes('useGetApiUsersId(id: string')) {
      throw new Error('GET with :id should have id param');
    }
    // Verify query key for detail uses params
    if (!output.includes('.detail(')) {
      throw new Error('Should have detail query key for parameterized routes');
    }
    console.log('  Path params in hooks ✓');

    // Step 11: Verify request input types for mutations
    console.log('\n=== Step 11: Verify input types for mutations ===');
    if (!output.includes('Input')) {
      throw new Error('POST/PUT mutations should have Input types');
    }
    console.log('  Input types for mutations ✓');

    // Step 12: Test --out flag
    console.log('\n=== Step 12: Test --out flag ===');
    runCli(`codegen --react-query --out ${outFile}`);
    if (!fs.existsSync(outFile)) {
      throw new Error('--out flag should write to file');
    }
    const fileContent = fs.readFileSync(outFile, 'utf-8');
    if (!fileContent.includes('useQuery')) {
      throw new Error('Written file should contain hooks');
    }
    console.log('  --out flag writes file ✓');

    // Step 13: Verify header
    console.log('\n=== Step 13: Verify header ===');
    if (!output.includes('Auto-generated React Query hooks by trickle')) {
      throw new Error('Should have auto-generated header');
    }
    console.log('  Auto-generated header ✓');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --react-query correctly generates typed TanStack Query hooks!\n');

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
