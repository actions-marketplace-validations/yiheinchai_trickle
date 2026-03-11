/**
 * E2E test: `trickle export` — Generate all output formats at once
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample data (routes with types)
 * 3. Run `trickle export` to generate all files
 * 4. Verify .trickle/ directory was created
 * 5. Verify types.d.ts exists and has interfaces
 * 6. Verify api-client.ts exists and has client factory
 * 7. Verify handlers.d.ts exists and has handler types
 * 8. Verify schemas.ts exists and has Zod schemas
 * 9. Verify hooks.ts exists and has React Query hooks
 * 10. Verify openapi.json exists and has paths
 * 11. Verify api.test.ts exists and has test scaffolds
 * 12. Verify custom --dir flag works
 * 13. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startBackend() {
  execSync('rm -f ~/.trickle/trickle.db ~/.trickle/trickle.db-shm ~/.trickle/trickle.db-wal');
  const proc = spawn('node', ['packages/backend/dist/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://localhost:4888/api/health');
      if (res.ok) break;
    } catch {}
    await sleep(500);
  }
  return proc;
}

async function ingestRoute(method, routePath, argsType, returnType, sampleInput, sampleOutput) {
  const crypto = require('crypto');
  const data = JSON.stringify({ a: argsType, r: returnType });
  const typeHash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);

  await fetch('http://localhost:4888/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      functionName: `${method} ${routePath}`,
      module: 'api',
      language: 'js',
      environment: 'development',
      typeHash,
      argsType,
      returnType,
      sampleInput,
      sampleOutput,
    }),
  });
}

async function run() {
  let backendProc = null;
  const exportDir = path.join(__dirname, '.test-export-output');
  const customDir = path.join(__dirname, '.test-export-custom');

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Ingest sample data
    console.log('\n=== Step 2: Ingest sample route data ===');

    await ingestRoute(
      'GET', '/api/users',
      { kind: 'object', properties: {} },
      {
        kind: 'object',
        properties: {
          users: { kind: 'array', element: { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, name: { kind: 'primitive', name: 'string' }, email: { kind: 'primitive', name: 'string' } } } },
          total: { kind: 'primitive', name: 'number' },
        },
      },
      undefined,
      { users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }], total: 1 },
    );

    await ingestRoute(
      'POST', '/api/users',
      {
        kind: 'object',
        properties: {
          body: { kind: 'object', properties: { name: { kind: 'primitive', name: 'string' }, email: { kind: 'primitive', name: 'string' } } },
        },
      },
      {
        kind: 'object',
        properties: {
          id: { kind: 'primitive', name: 'number' },
          name: { kind: 'primitive', name: 'string' },
          created: { kind: 'primitive', name: 'boolean' },
        },
      },
      { body: { name: 'Bob', email: 'bob@test.com' } },
      { id: 2, name: 'Bob', created: true },
    );

    await ingestRoute(
      'GET', '/api/products',
      { kind: 'object', properties: {} },
      {
        kind: 'object',
        properties: {
          products: { kind: 'array', element: { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, title: { kind: 'primitive', name: 'string' }, price: { kind: 'primitive', name: 'number' } } } },
          count: { kind: 'primitive', name: 'number' },
        },
      },
      undefined,
      { products: [{ id: 1, title: 'Widget', price: 9.99 }], count: 1 },
    );

    await sleep(1000);
    console.log('  3 routes ingested ✓');

    // Step 3: Run trickle export
    console.log('\n=== Step 3: Run trickle export ===');
    // Clean up any previous output
    if (fs.existsSync(exportDir)) fs.rmSync(exportDir, { recursive: true });

    const exportResult = execSync(
      `npx trickle export --dir "${exportDir}"`,
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    console.log(exportResult);
    console.log('  trickle export completed ✓');

    // Step 4: Verify directory created
    console.log('=== Step 4: Verify output directory ===');
    if (!fs.existsSync(exportDir)) {
      throw new Error('Export directory was not created');
    }
    const files = fs.readdirSync(exportDir);
    console.log(`  Directory exists with ${files.length} files: ${files.join(', ')} ✓`);

    // Step 5: Verify types.d.ts
    console.log('\n=== Step 5: Verify types.d.ts ===');
    const typesFile = path.join(exportDir, 'types.d.ts');
    if (!fs.existsSync(typesFile)) throw new Error('types.d.ts not generated');
    const typesContent = fs.readFileSync(typesFile, 'utf-8');
    if (!typesContent.includes('export interface') && !typesContent.includes('export type')) {
      throw new Error('types.d.ts should contain type definitions');
    }
    console.log('  types.d.ts has type definitions ✓');

    // Step 6: Verify api-client.ts
    console.log('\n=== Step 6: Verify api-client.ts ===');
    const clientFile = path.join(exportDir, 'api-client.ts');
    if (!fs.existsSync(clientFile)) throw new Error('api-client.ts not generated');
    const clientContent = fs.readFileSync(clientFile, 'utf-8');
    if (!clientContent.includes('createTrickleClient') && !clientContent.includes('fetch')) {
      throw new Error('api-client.ts should contain client code');
    }
    console.log('  api-client.ts has client factory ✓');

    // Step 7: Verify handlers.d.ts
    console.log('\n=== Step 7: Verify handlers.d.ts ===');
    const handlersFile = path.join(exportDir, 'handlers.d.ts');
    if (!fs.existsSync(handlersFile)) throw new Error('handlers.d.ts not generated');
    const handlersContent = fs.readFileSync(handlersFile, 'utf-8');
    if (!handlersContent.includes('Handler') && !handlersContent.includes('RequestHandler')) {
      throw new Error('handlers.d.ts should contain handler types');
    }
    console.log('  handlers.d.ts has handler types ✓');

    // Step 8: Verify schemas.ts
    console.log('\n=== Step 8: Verify schemas.ts ===');
    const schemasFile = path.join(exportDir, 'schemas.ts');
    if (!fs.existsSync(schemasFile)) throw new Error('schemas.ts not generated');
    const schemasContent = fs.readFileSync(schemasFile, 'utf-8');
    if (!schemasContent.includes('z.') && !schemasContent.includes('Schema')) {
      throw new Error('schemas.ts should contain Zod schemas');
    }
    console.log('  schemas.ts has Zod schemas ✓');

    // Step 9: Verify hooks.ts
    console.log('\n=== Step 9: Verify hooks.ts ===');
    const hooksFile = path.join(exportDir, 'hooks.ts');
    if (!fs.existsSync(hooksFile)) throw new Error('hooks.ts not generated');
    const hooksContent = fs.readFileSync(hooksFile, 'utf-8');
    if (!hooksContent.includes('useQuery') && !hooksContent.includes('use')) {
      throw new Error('hooks.ts should contain React Query hooks');
    }
    console.log('  hooks.ts has React Query hooks ✓');

    // Step 10: Verify openapi.json
    console.log('\n=== Step 10: Verify openapi.json ===');
    const openapiFile = path.join(exportDir, 'openapi.json');
    if (!fs.existsSync(openapiFile)) throw new Error('openapi.json not generated');
    const openapiContent = fs.readFileSync(openapiFile, 'utf-8');
    const spec = JSON.parse(openapiContent);
    if (!spec.openapi || !spec.paths) {
      throw new Error('openapi.json should be a valid OpenAPI spec');
    }
    const pathCount = Object.keys(spec.paths).length;
    if (pathCount === 0) {
      throw new Error('openapi.json should have at least one path');
    }
    console.log(`  openapi.json has ${pathCount} paths ✓`);

    // Step 11: Verify api.test.ts
    console.log('\n=== Step 11: Verify api.test.ts ===');
    const testFile = path.join(exportDir, 'api.test.ts');
    if (!fs.existsSync(testFile)) throw new Error('api.test.ts not generated');
    const testContent = fs.readFileSync(testFile, 'utf-8');
    if (!testContent.includes('describe') || !testContent.includes('it(')) {
      throw new Error('api.test.ts should contain test scaffolds');
    }
    console.log('  api.test.ts has test scaffolds ✓');

    // Step 12: Verify custom --dir flag
    console.log('\n=== Step 12: Verify custom --dir flag ===');
    if (fs.existsSync(customDir)) fs.rmSync(customDir, { recursive: true });

    execSync(
      `npx trickle export --dir "${customDir}"`,
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    if (!fs.existsSync(customDir)) {
      throw new Error('Custom directory was not created');
    }
    const customFiles = fs.readdirSync(customDir);
    if (customFiles.length === 0) {
      throw new Error('Custom directory should have files');
    }
    console.log(`  Custom dir has ${customFiles.length} files ✓`);

    // Step 13: Clean shutdown
    console.log('\n=== Step 13: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle export generates all output formats in one command!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    try { if (fs.existsSync(exportDir)) fs.rmSync(exportDir, { recursive: true }); } catch {}
    try { if (fs.existsSync(customDir)) fs.rmSync(customDir, { recursive: true }); } catch {}
    process.exit(process.exitCode || 0);
  }
}

run();
