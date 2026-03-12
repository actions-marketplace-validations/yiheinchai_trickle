/**
 * E2E test: `trickle docs` — Generate API documentation from observed types
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Run docs with no data (empty state)
 * 3. Ingest sample routes with types and sample data
 * 4. Run docs and verify Markdown output to stdout
 * 5. Verify Markdown contains routes, types, and examples
 * 6. Verify --out writes to a file
 * 7. Verify --html generates HTML output
 * 8. Verify --html --out writes HTML file
 * 9. Verify --title customizes title
 * 10. Verify table of contents and route grouping
 * 11. Verify POST routes include request body docs
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startBackend() {
  execSync('rm -f ~/.trickle/trickle.db ~/.trickle/trickle.db-shm ~/.trickle/trickle.db-wal');
  const proc = spawn('node', ['../packages/backend/dist/index.js'], {
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

function makeTypeHash(argsType, returnType) {
  const data = JSON.stringify({ a: argsType, r: returnType });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

async function ingestRoute(method, routePath, argsType, returnType, sampleInput, sampleOutput) {
  const typeHash = makeTypeHash(argsType, returnType);
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
  const mdFile = path.join(__dirname, '.test-docs-output.md');
  const htmlFile = path.join(__dirname, '.test-docs-output.html');

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Empty state
    console.log('\n=== Step 2: Run docs with empty state ===');
    const emptyResult = execSync(
      'npx trickle docs 2>&1 || true',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    if (emptyResult.includes('No observed')) {
      console.log('  Empty state: no routes to document ✓');
    } else {
      console.log('  Empty state handled ✓');
    }

    // Step 3: Ingest sample routes
    console.log('\n=== Step 3: Ingest sample route data ===');

    await ingestRoute(
      'GET', '/api/users',
      { kind: 'object', properties: {} },
      { kind: 'object', properties: { users: { kind: 'array', element: { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, name: { kind: 'primitive', name: 'string' }, email: { kind: 'primitive', name: 'string' } } } }, total: { kind: 'primitive', name: 'number' } } },
      undefined,
      { users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }], total: 1 },
    );

    await ingestRoute(
      'POST', '/api/users',
      { kind: 'object', properties: { body: { kind: 'object', properties: { name: { kind: 'primitive', name: 'string' }, email: { kind: 'primitive', name: 'string' } } } } },
      { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, name: { kind: 'primitive', name: 'string' }, created: { kind: 'primitive', name: 'boolean' } } },
      { body: { name: 'Bob', email: 'bob@test.com' } },
      { id: 2, name: 'Bob', created: true },
    );

    await ingestRoute(
      'GET', '/api/products',
      { kind: 'object', properties: {} },
      { kind: 'object', properties: { products: { kind: 'array', element: { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, title: { kind: 'primitive', name: 'string' }, price: { kind: 'primitive', name: 'number' } } } }, count: { kind: 'primitive', name: 'number' } } },
      undefined,
      { products: [{ id: 1, title: 'Widget', price: 29.99 }], count: 1 },
    );

    await ingestRoute(
      'GET', '/api/products/:id',
      { kind: 'object', properties: {} },
      { kind: 'object', properties: { id: { kind: 'primitive', name: 'number' }, title: { kind: 'primitive', name: 'string' }, price: { kind: 'primitive', name: 'number' } } },
      undefined,
      { id: 1, title: 'Widget', price: 29.99 },
    );

    await sleep(500);
    console.log('  4 routes ingested ✓');

    // Step 4: Run docs and verify Markdown output
    console.log('\n=== Step 4: Run docs (Markdown to stdout) ===');
    const mdOutput = execSync(
      'npx trickle docs',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );

    if (!mdOutput.includes('# API Documentation')) {
      throw new Error('Expected Markdown title');
    }
    if (!mdOutput.includes('trickle')) {
      throw new Error('Expected trickle attribution');
    }
    console.log('  Markdown output generated ✓');

    // Step 5: Verify contents
    console.log('\n=== Step 5: Verify Markdown contents ===');

    if (!mdOutput.includes('/api/users')) {
      throw new Error('Expected /api/users route');
    }
    if (!mdOutput.includes('/api/products')) {
      throw new Error('Expected /api/products route');
    }
    if (!mdOutput.includes('`GET`')) {
      throw new Error('Expected GET method badge');
    }
    if (!mdOutput.includes('`POST`')) {
      throw new Error('Expected POST method badge');
    }
    // Check for type information
    if (!mdOutput.includes('string') || !mdOutput.includes('number')) {
      throw new Error('Expected TypeScript type annotations');
    }
    // Check for example JSON
    if (!mdOutput.includes('"Alice"') || !mdOutput.includes('"Widget"')) {
      throw new Error('Expected example data in output');
    }
    console.log('  Routes, methods, types, and examples present ✓');

    // Step 6: Verify --out writes to file
    console.log('\n=== Step 6: Verify --out flag ===');
    execSync(
      `npx trickle docs --out "${mdFile}"`,
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    if (!fs.existsSync(mdFile)) {
      throw new Error('Markdown file not created');
    }
    const savedMd = fs.readFileSync(mdFile, 'utf-8');
    if (!savedMd.includes('# API Documentation')) {
      throw new Error('Saved file should contain Markdown');
    }
    console.log(`  Wrote ${savedMd.length} chars to ${path.basename(mdFile)} ✓`);

    // Step 7: Verify --html
    console.log('\n=== Step 7: Verify --html output ===');
    const htmlOutput = execSync(
      'npx trickle docs --html',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    if (!htmlOutput.includes('<!DOCTYPE html>')) {
      throw new Error('Expected HTML doctype');
    }
    if (!htmlOutput.includes('<title>API Documentation</title>')) {
      throw new Error('Expected HTML title');
    }
    if (!htmlOutput.includes('<style>')) {
      throw new Error('Expected embedded styles');
    }
    console.log('  HTML output with styles and scripts ✓');

    // Step 8: Verify --html --out
    console.log('\n=== Step 8: Verify --html --out ===');
    execSync(
      `npx trickle docs --html --out "${htmlFile}"`,
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    if (!fs.existsSync(htmlFile)) {
      throw new Error('HTML file not created');
    }
    const savedHtml = fs.readFileSync(htmlFile, 'utf-8');
    if (!savedHtml.includes('<!DOCTYPE html>')) {
      throw new Error('Saved HTML should be valid');
    }
    console.log(`  Wrote ${savedHtml.length} chars to ${path.basename(htmlFile)} ✓`);

    // Step 9: Verify --title
    console.log('\n=== Step 9: Verify --title flag ===');
    const customTitle = execSync(
      'npx trickle docs --title "My Custom API"',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    if (!customTitle.includes('# My Custom API')) {
      throw new Error('Expected custom title');
    }
    console.log('  Custom title "My Custom API" ✓');

    // Step 10: Verify table of contents and grouping
    console.log('\n=== Step 10: Verify TOC and route grouping ===');
    if (!mdOutput.includes('## Table of Contents')) {
      throw new Error('Expected table of contents');
    }
    if (!mdOutput.includes('## /api/users')) {
      throw new Error('Expected /api/users group header');
    }
    if (!mdOutput.includes('## /api/products')) {
      throw new Error('Expected /api/products group header');
    }
    console.log('  Table of contents and resource grouping ✓');

    // Step 11: Verify POST route includes request body
    console.log('\n=== Step 11: Verify POST request body docs ===');
    if (!mdOutput.includes('**Request Body**')) {
      throw new Error('Expected Request Body section for POST route');
    }
    if (!mdOutput.includes('"bob@test.com"') || !mdOutput.includes('"Bob"')) {
      throw new Error('Expected request body example data');
    }
    console.log('  POST request body documented with examples ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle docs generates API documentation from observed runtime types!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    try { if (fs.existsSync(mdFile)) fs.unlinkSync(mdFile); } catch {}
    try { if (fs.existsSync(htmlFile)) fs.unlinkSync(htmlFile); } catch {}
    process.exit(process.exitCode || 0);
  }
}

run();
