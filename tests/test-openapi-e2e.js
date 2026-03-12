/**
 * E2E test: `trickle openapi` — Generate OpenAPI 3.0 spec from runtime types
 *
 * Tests:
 * 1. Start backend, instrument an Express app, make requests to populate types
 * 2. Call the backend API with format=openapi and validate the spec structure
 * 3. Verify paths, methods, operationIds, schemas, request bodies
 * 4. Test CLI `trickle openapi` with stdout output
 * 5. Test CLI `trickle openapi --out` writes a valid JSON file
 * 6. Test --title and --version flags
 * 7. Test --server flag adds servers array
 * 8. Verify path parameters use OpenAPI {param} syntax
 * 9. Verify POST routes have requestBody schemas
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
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
  const tmpFile = path.join(__dirname, '.test-openapi-output.json');

  try {
    // Step 1: Start backend and populate types
    console.log('=== Step 1: Start backend and populate types ===');
    execSync('rm -f ~/.trickle/trickle.db');
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(4888);
    console.log('  Backend running ✓');

    configure({ backendUrl: 'http://localhost:4888', batchIntervalMs: 500, debug: false });

    const app = express();
    app.use(express.json());
    instrument(app);

    // Define routes with different HTTP methods
    app.get('/api/users', (req, res) => {
      res.json({
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com', active: true },
          { id: 2, name: 'Bob', email: 'bob@example.com', active: false },
        ],
        total: 2,
        page: 1,
      });
    });

    app.get('/api/users/:id', (req, res) => {
      res.json({
        id: parseInt(req.params.id),
        name: 'Alice',
        email: 'alice@example.com',
        active: true,
        createdAt: '2024-01-15T00:00:00Z',
      });
    });

    app.post('/api/users', (req, res) => {
      const { name, email } = req.body;
      res.json({ id: 3, name, email, active: true });
    });

    app.put('/api/users/:id', (req, res) => {
      const { name, email } = req.body;
      res.json({ id: parseInt(req.params.id), name, email, updated: true });
    });

    app.delete('/api/users/:id', (req, res) => {
      res.json({ deleted: true, id: parseInt(req.params.id) });
    });

    app.get('/api/products', (req, res) => {
      res.json({
        products: [
          { id: 1, title: 'Widget', price: 29.99, category: 'electronics' },
        ],
        count: 1,
      });
    });

    const server = await new Promise((resolve) => {
      const s = app.listen(3464, () => resolve(s));
    });

    // Make requests to populate types
    await fetch('http://localhost:3464/api/users');
    await fetch('http://localhost:3464/api/users/1');
    await fetch('http://localhost:3464/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com' }),
    });
    await fetch('http://localhost:3464/api/users/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Updated', email: 'alice2@example.com' }),
    });
    await fetch('http://localhost:3464/api/users/1', { method: 'DELETE' });
    await fetch('http://localhost:3464/api/products');
    console.log('  All requests made ✓');

    await flush();
    await sleep(2000);
    await flush();
    server.close();
    console.log('  Types flushed ✓');

    // Step 2: Test backend API directly
    console.log('\n=== Step 2: Test backend /api/codegen?format=openapi ===');
    let resp = await fetch('http://localhost:4888/api/codegen?format=openapi');
    let spec = await resp.json();

    if (resp.status !== 200) throw new Error(`Expected 200, got ${resp.status}`);
    if (spec.openapi !== '3.0.3') throw new Error(`Expected openapi 3.0.3, got ${spec.openapi}`);
    if (!spec.info) throw new Error('Missing info object');
    if (!spec.paths) throw new Error('Missing paths object');
    console.log(`  openapi: ${spec.openapi} ✓`);
    console.log(`  info.title: "${spec.info.title}" ✓`);

    // Step 3: Verify paths
    console.log('\n=== Step 3: Verify paths and operations ===');
    const pathKeys = Object.keys(spec.paths);
    console.log(`  ${pathKeys.length} paths found`);

    // Check /api/users exists
    if (!spec.paths['/api/users']) throw new Error('Missing /api/users path');
    console.log('  /api/users path exists ✓');

    // Check GET and POST on /api/users
    if (!spec.paths['/api/users'].get) throw new Error('Missing GET /api/users');
    if (!spec.paths['/api/users'].post) throw new Error('Missing POST /api/users');
    console.log('  GET and POST /api/users ✓');

    // Check /api/users/{id} uses OpenAPI param syntax (not :id)
    if (!spec.paths['/api/users/{id}']) throw new Error('Missing /api/users/{id} (should use {id} not :id)');
    console.log('  /api/users/{id} uses OpenAPI syntax ✓');

    // Check multiple methods on /api/users/{id}
    const userIdPath = spec.paths['/api/users/{id}'];
    if (!userIdPath.get) throw new Error('Missing GET /api/users/{id}');
    if (!userIdPath.put) throw new Error('Missing PUT /api/users/{id}');
    if (!userIdPath.delete) throw new Error('Missing DELETE /api/users/{id}');
    console.log('  GET, PUT, DELETE /api/users/{id} ✓');

    // Check /api/products
    if (!spec.paths['/api/products']) throw new Error('Missing /api/products');
    console.log('  /api/products path exists ✓');

    // Step 4: Verify operation structure
    console.log('\n=== Step 4: Verify operation details ===');

    // Check operationId exists
    const getUsersOp = spec.paths['/api/users'].get;
    if (!getUsersOp.operationId) throw new Error('Missing operationId on GET /api/users');
    console.log(`  GET /api/users operationId: "${getUsersOp.operationId}" ✓`);

    // Check response schema
    const response200 = getUsersOp.responses['200'];
    if (!response200) throw new Error('Missing 200 response');
    if (!response200.content?.['application/json']?.schema) throw new Error('Missing response schema');
    console.log('  Response schema present ✓');

    // Check path parameters on /api/users/{id}
    const getUserByIdOp = userIdPath.get;
    if (!getUserByIdOp.parameters || getUserByIdOp.parameters.length === 0) {
      throw new Error('Missing path parameters on GET /api/users/{id}');
    }
    const idParam = getUserByIdOp.parameters.find(p => p.name === 'id');
    if (!idParam) throw new Error('Missing "id" path parameter');
    if (idParam.in !== 'path') throw new Error('id param should be "in: path"');
    if (idParam.required !== true) throw new Error('Path param should be required');
    console.log('  Path parameter "id" (in: path, required: true) ✓');

    // Check requestBody on POST /api/users
    const postUsersOp = spec.paths['/api/users'].post;
    if (!postUsersOp.requestBody) throw new Error('Missing requestBody on POST /api/users');
    if (!postUsersOp.requestBody.content?.['application/json']?.schema) {
      throw new Error('Missing request body schema');
    }
    console.log('  POST /api/users has requestBody schema ✓');

    // Step 5: Verify schemas/components
    console.log('\n=== Step 5: Verify component schemas ===');
    if (!spec.components?.schemas) throw new Error('Missing components.schemas');
    const schemaKeys = Object.keys(spec.components.schemas);
    console.log(`  ${schemaKeys.length} schemas defined`);
    if (schemaKeys.length === 0) throw new Error('Expected at least 1 schema');
    for (const key of schemaKeys) {
      const schema = spec.components.schemas[key];
      if (!schema.type && !schema.$ref && !schema.oneOf) {
        throw new Error(`Schema "${key}" has no type, $ref, or oneOf`);
      }
    }
    console.log('  All schemas are valid ✓');

    // Step 6: Test tags
    console.log('\n=== Step 6: Verify tags ===');
    if (!getUsersOp.tags || !getUsersOp.tags.includes('users')) {
      throw new Error('GET /api/users should have tag "users"');
    }
    console.log('  GET /api/users tagged as "users" ✓');

    const getProductsOp = spec.paths['/api/products'].get;
    if (!getProductsOp.tags || !getProductsOp.tags.includes('products')) {
      throw new Error('GET /api/products should have tag "products"');
    }
    console.log('  GET /api/products tagged as "products" ✓');

    // Step 7: Test CLI stdout
    console.log('\n=== Step 7: Test CLI `trickle openapi` ===');
    let cliOutput = execSync('npx trickle openapi', { encoding: 'utf-8' });
    let cliSpec = JSON.parse(cliOutput);
    if (cliSpec.openapi !== '3.0.3') throw new Error('CLI output invalid OpenAPI version');
    if (!cliSpec.paths) throw new Error('CLI output missing paths');
    console.log('  `trickle openapi` outputs valid JSON spec ✓');

    // Step 8: Test CLI --out flag
    console.log('\n=== Step 8: Test CLI `trickle openapi --out` ===');
    execSync(`npx trickle openapi --out ${tmpFile}`, { encoding: 'utf-8' });
    if (!fs.existsSync(tmpFile)) throw new Error('Output file not created');
    const fileContent = fs.readFileSync(tmpFile, 'utf-8');
    const fileSpec = JSON.parse(fileContent);
    if (fileSpec.openapi !== '3.0.3') throw new Error('File spec invalid version');
    console.log('  --out writes valid JSON file ✓');

    // Step 9: Test --title and --version flags
    console.log('\n=== Step 9: Test --title and --version flags ===');
    cliOutput = execSync('npx trickle openapi --title "My API" --api-version "2.0.0"', { encoding: 'utf-8' });
    cliSpec = JSON.parse(cliOutput);
    if (cliSpec.info.title !== 'My API') throw new Error(`Expected title "My API", got "${cliSpec.info.title}"`);
    if (cliSpec.info.version !== '2.0.0') throw new Error(`Expected version "2.0.0", got "${cliSpec.info.version}"`);
    console.log(`  title: "${cliSpec.info.title}", version: "${cliSpec.info.version}" ✓`);

    // Step 10: Test --server flag
    console.log('\n=== Step 10: Test --server flag ===');
    cliOutput = execSync('npx trickle openapi --server "https://api.example.com"', { encoding: 'utf-8' });
    cliSpec = JSON.parse(cliOutput);
    if (!cliSpec.servers || cliSpec.servers.length === 0) throw new Error('Missing servers array');
    if (cliSpec.servers[0].url !== 'https://api.example.com') throw new Error('Wrong server URL');
    console.log(`  servers[0].url: "${cliSpec.servers[0].url}" ✓`);

    // Step 11: Validate spec is usable (all $refs resolve)
    console.log('\n=== Step 11: Validate $ref resolution ===');
    function validateRefs(obj, root) {
      if (typeof obj !== 'object' || obj === null) return;
      if (obj.$ref) {
        const refPath = obj.$ref.replace('#/', '').split('/');
        let current = root;
        for (const part of refPath) {
          current = current[part];
          if (current === undefined) {
            throw new Error(`Unresolved $ref: ${obj.$ref}`);
          }
        }
      }
      for (const value of Object.values(obj)) {
        validateRefs(value, root);
      }
    }
    validateRefs(cliSpec, cliSpec);
    console.log('  All $refs resolve correctly ✓');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle openapi correctly generates OpenAPI 3.0 specs from runtime types!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
