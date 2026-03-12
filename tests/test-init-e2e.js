/**
 * E2E test: `trickle init` — project setup wizard
 *
 * Tests:
 * 1. Creates a temporary project directory with package.json + tsconfig.json
 * 2. Runs `trickle init` in that directory
 * 3. Verifies .trickle/ directory and files are created
 * 4. Verifies tsconfig.json is updated with .trickle in include
 * 5. Verifies package.json has trickle npm scripts
 * 6. Verifies .gitignore has .trickle/
 * 7. Full flow: instruments Express app, runs codegen, verifies types appear in .trickle/
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const TEST_DIR = path.join(__dirname, '.test-init-project');
const TRICKLE_ROOT = __dirname;

function setup() {
  // Clean up any previous test
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Create a minimal package.json with express dependency and a start script
  fs.writeFileSync(
    path.join(TEST_DIR, 'package.json'),
    JSON.stringify({
      name: 'test-init-project',
      version: '1.0.0',
      scripts: {
        start: 'node server.js',
        dev: 'nodemon server.js',
      },
      dependencies: {
        express: '^4.18.0',
      },
    }, null, 2),
  );

  // Create a tsconfig.json
  fs.writeFileSync(
    path.join(TEST_DIR, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        strict: true,
        outDir: './dist',
      },
      include: ['src'],
    }, null, 2),
  );

  // Create a src directory
  fs.mkdirSync(path.join(TEST_DIR, 'src'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'src', 'index.ts'), '// entry\n');

  // Create a .gitignore
  fs.writeFileSync(path.join(TEST_DIR, '.gitignore'), 'node_modules/\ndist/\n');

  // Create server.js (a simple Express app with NO trickle code)
  fs.writeFileSync(
    path.join(TEST_DIR, 'server.js'),
    `const express = require('express');
const app = express();
app.use(express.json());

app.get('/api/items', (req, res) => {
  res.json({ items: [{ id: 1, name: 'Test Item', price: 9.99 }], count: 1 });
});

app.post('/api/items', (req, res) => {
  res.json({ id: 2, ...req.body, created: true });
});

const server = app.listen(3461, () => console.log('READY'));
process.on('SIGTERM', () => server.close());
`,
  );
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

async function run() {
  let backendProc = null;
  let appProc = null;

  try {
    setup();

    // Step 1: Run trickle init
    console.log('=== Step 1: Run trickle init ===');
    const initOutput = execSync(`npx trickle init --dir ${TEST_DIR}`, {
      cwd: TRICKLE_ROOT,
      encoding: 'utf-8',
    });
    console.log(initOutput);

    // Step 2: Verify .trickle/ directory created
    console.log('=== Step 2: Verify .trickle/ directory ===');
    const trickleDir = path.join(TEST_DIR, '.trickle');
    if (!fs.existsSync(trickleDir)) throw new Error('.trickle/ directory not created');
    console.log('  .trickle/ exists ✓');

    if (!fs.existsSync(path.join(trickleDir, 'types.d.ts'))) {
      throw new Error('.trickle/types.d.ts not created');
    }
    console.log('  .trickle/types.d.ts exists ✓');

    if (!fs.existsSync(path.join(trickleDir, 'api-client.ts'))) {
      throw new Error('.trickle/api-client.ts not created');
    }
    console.log('  .trickle/api-client.ts exists ✓');

    // Step 3: Verify tsconfig.json updated
    console.log('\n=== Step 3: Verify tsconfig.json ===');
    const tsConfig = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'tsconfig.json'), 'utf-8'));
    if (!tsConfig.include || !tsConfig.include.includes('.trickle')) {
      throw new Error('tsconfig.json does not include .trickle');
    }
    console.log(`  include: ${JSON.stringify(tsConfig.include)} ✓`);

    // Step 4: Verify package.json scripts
    console.log('\n=== Step 4: Verify package.json scripts ===');
    const pkg = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'package.json'), 'utf-8'));

    if (!pkg.scripts['trickle:dev']) throw new Error('trickle:dev script missing');
    console.log(`  trickle:dev: "${pkg.scripts['trickle:dev']}" ✓`);

    if (!pkg.scripts['trickle:client']) throw new Error('trickle:client script missing');
    console.log(`  trickle:client: "${pkg.scripts['trickle:client']}" ✓`);

    if (!pkg.scripts['trickle:mock']) throw new Error('trickle:mock script missing');
    console.log(`  trickle:mock: "${pkg.scripts['trickle:mock']}" ✓`);

    if (!pkg.scripts['trickle:start']) throw new Error('trickle:start script missing');
    console.log(`  trickle:start: "${pkg.scripts['trickle:start']}" ✓`);

    // Verify the start script was correctly modified
    if (!pkg.scripts['trickle:start'].includes('-r trickle/register')) {
      throw new Error('trickle:start does not include -r trickle/register');
    }
    console.log('  trickle:start includes -r trickle/register ✓');

    // Step 5: Verify .gitignore
    console.log('\n=== Step 5: Verify .gitignore ===');
    const gitignore = fs.readFileSync(path.join(TEST_DIR, '.gitignore'), 'utf-8');
    if (!gitignore.includes('.trickle/')) throw new Error('.gitignore does not include .trickle/');
    console.log('  .gitignore has .trickle/ ✓');

    // Step 6: Verify idempotent — running init again doesn't duplicate things
    console.log('\n=== Step 6: Verify idempotent (run init again) ===');
    execSync(`npx trickle init --dir ${TEST_DIR}`, {
      cwd: TRICKLE_ROOT,
      encoding: 'utf-8',
    });

    const pkg2 = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'package.json'), 'utf-8'));
    const tsConfig2 = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'tsconfig.json'), 'utf-8'));
    const gitignore2 = fs.readFileSync(path.join(TEST_DIR, '.gitignore'), 'utf-8');

    // Check no duplicates in tsconfig include
    const trickleIncludes = tsConfig2.include.filter((p) => p === '.trickle');
    if (trickleIncludes.length !== 1) {
      throw new Error(`tsconfig.json has ${trickleIncludes.length} .trickle entries (expected 1)`);
    }
    console.log('  tsconfig.json: no duplicate .trickle entries ✓');

    // Check no duplicate .trickle/ in gitignore
    const trickleLines = gitignore2.split('\n').filter((l) => l.trim() === '.trickle/');
    if (trickleLines.length !== 1) {
      throw new Error(`.gitignore has ${trickleLines.length} .trickle/ entries (expected 1)`);
    }
    console.log('  .gitignore: no duplicate .trickle/ entries ✓');

    // Step 7: Full flow — start backend, instrument app, codegen into .trickle/
    console.log('\n=== Step 7: Full flow — types appear in .trickle/ ===');

    execSync('rm -f ~/.trickle/trickle.db');
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      cwd: TRICKLE_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(4888);
    console.log('  Backend running ✓');

    // Start the Express app with -r trickle/register
    appProc = spawn('node', ['-r', path.join(TRICKLE_ROOT, '../packages/client-js/register.js'), 'server.js'], {
      cwd: TEST_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TRICKLE_BACKEND_URL: 'http://localhost:4888',
        TRICKLE_DEBUG: '1',
        // Need node_modules access
        NODE_PATH: path.join(TRICKLE_ROOT, 'node_modules'),
      },
    });
    appProc.stderr.on('data', () => {});
    await waitForServer(3461);
    console.log('  Express app running (zero trickle code) ✓');

    // Make requests
    await fetch('http://localhost:3461/api/items');
    await fetch('http://localhost:3461/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Item', price: 19.99 }),
    });
    console.log('  API requests made ✓');

    // Wait for flush
    await sleep(4000);

    // Run codegen into .trickle/types.d.ts
    execSync(`npx trickle codegen --out ${path.join(TEST_DIR, '.trickle/types.d.ts')}`, {
      cwd: TRICKLE_ROOT,
      encoding: 'utf-8',
    });

    // Also generate API client
    execSync(`npx trickle codegen --client --out ${path.join(TEST_DIR, '.trickle/api-client.ts')}`, {
      cwd: TRICKLE_ROOT,
      encoding: 'utf-8',
    });

    // Verify types.d.ts has actual type content
    const typesContent = fs.readFileSync(path.join(TEST_DIR, '.trickle/types.d.ts'), 'utf-8');
    if (!typesContent.includes('export interface')) {
      throw new Error('.trickle/types.d.ts has no interfaces');
    }
    const interfaceCount = (typesContent.match(/export interface/g) || []).length;
    console.log(`  .trickle/types.d.ts: ${interfaceCount} interfaces generated ✓`);

    // Verify api-client.ts has client code
    const clientContent = fs.readFileSync(path.join(TEST_DIR, '.trickle/api-client.ts'), 'utf-8');
    if (!clientContent.includes('createTrickleClient')) {
      throw new Error('.trickle/api-client.ts has no client factory');
    }
    console.log('  .trickle/api-client.ts: typed client generated ✓');

    // Validate types compile
    try {
      execSync(`npx tsc --noEmit --strict ${path.join(TEST_DIR, '.trickle/types.d.ts')}`, {
        cwd: TRICKLE_ROOT,
        stdio: 'pipe',
      });
      console.log('  TypeScript compilation: PASS ✓');
    } catch (err) {
      throw new Error('Types do not compile with tsc --strict');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle init correctly sets up the project end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (appProc) { appProc.kill('SIGTERM'); await sleep(300); }
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    cleanup();
    process.exit(process.exitCode || 0);
  }
}

run();
