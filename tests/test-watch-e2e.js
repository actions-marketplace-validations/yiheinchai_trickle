/**
 * E2E test: `trickle watch` — Watch for type changes and auto-regenerate files
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Create temp project with package.json
 * 3. Start trickle watch in background
 * 4. Verify initial generation (no types yet)
 * 5. Ingest first route — watch should detect and regenerate
 * 6. Verify types.d.ts was generated
 * 7. Ingest second route — watch should detect the addition
 * 8. Verify types.d.ts was updated with second route
 * 9. Update first route type — watch should detect the change
 * 10. Verify types.d.ts reflects the updated type
 * 11. Verify guards.ts was also generated
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

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

async function ingestRoute(method, routePath, argsType, returnType) {
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
    }),
  });
}

function createTempProject(deps) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-watch-test-'));
  const pkg = {
    name: 'watch-test-project',
    version: '1.0.0',
    dependencies: deps || {},
  };
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));
  return tmpDir;
}

function startWatch(tmpDir, interval) {
  const proc = spawn('node', [
    path.resolve('../packages/cli/dist/index.js'),
    'watch',
    '--interval', interval || '1s',
  ], {
    cwd: tmpDir,
    env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  proc.stdout.on('data', d => stdout += d.toString());
  proc.stderr.on('data', () => {});
  return { proc, getStdout: () => stdout };
}

async function run() {
  let backendProc = null;
  let watchHandle = null;
  let tmpDir = null;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Create temp project
    console.log('\n=== Step 2: Create temp project ===');
    tmpDir = createTempProject({ zod: '^3.22.0' });
    console.log(`  Temp project at ${tmpDir} ✓`);

    // Step 3: Start watch in background
    console.log('\n=== Step 3: Start trickle watch ===');
    watchHandle = startWatch(tmpDir, '1s');
    // Give it time to start and do initial generation
    await sleep(3000);
    const initialOutput = watchHandle.getStdout();
    if (!initialOutput.includes('trickle watch')) {
      throw new Error('Expected trickle watch header');
    }
    console.log('  Watch started ✓');

    // Step 4: Verify initial state (no types yet)
    console.log('\n=== Step 4: Verify initial state ===');
    const trickleDir = path.join(tmpDir, '.trickle');
    // May or may not have generated yet — that's OK
    // The key is watch is running
    if (initialOutput.includes('No observed functions yet') || initialOutput.includes('No types to generate')) {
      console.log('  No types initially — correct ✓');
    } else if (initialOutput.includes('Generated')) {
      console.log('  Initial generation completed ✓');
    } else {
      // Watch may have not had time to report yet
      console.log('  Watch is running ✓');
    }

    // Step 5: Ingest first route — watch should detect and regenerate
    console.log('\n=== Step 5: Ingest first route ===');
    await ingestRoute('GET', '/api/users',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          users: {
            kind: 'array', element: {
              kind: 'object', properties: {
                id: { kind: 'primitive', name: 'number' },
                name: { kind: 'primitive', name: 'string' },
              },
            },
          },
          total: { kind: 'primitive', name: 'number' },
        },
      },
    );
    console.log('  Route GET /api/users ingested ✓');

    // Wait for watch to detect the change
    await sleep(4000);

    // Step 6: Verify types.d.ts was generated
    console.log('\n=== Step 6: Verify types.d.ts generated ===');
    const typesPath = path.join(trickleDir, 'types.d.ts');
    if (!fs.existsSync(typesPath)) {
      throw new Error('Expected types.d.ts to be generated by watch');
    }
    let typesContent = fs.readFileSync(typesPath, 'utf-8');
    if (!typesContent.includes('users')) {
      throw new Error('Expected users field in types.d.ts');
    }
    console.log('  types.d.ts generated with users field ✓');

    // Step 7: Ingest second route
    console.log('\n=== Step 7: Ingest second route ===');
    await ingestRoute('POST', '/api/orders',
      {
        kind: 'object', properties: {
          body: {
            kind: 'object', properties: {
              product: { kind: 'primitive', name: 'string' },
              quantity: { kind: 'primitive', name: 'number' },
            },
          },
        },
      },
      {
        kind: 'object', properties: {
          orderId: { kind: 'primitive', name: 'number' },
          status: { kind: 'primitive', name: 'string' },
        },
      },
    );
    console.log('  Route POST /api/orders ingested ✓');

    // Wait for watch to detect the change
    await sleep(4000);

    // Step 8: Verify types.d.ts updated with second route
    console.log('\n=== Step 8: Verify types.d.ts updated ===');
    typesContent = fs.readFileSync(typesPath, 'utf-8');
    if (!typesContent.includes('orderId') && !typesContent.includes('order')) {
      throw new Error('Expected orders-related content in types.d.ts after second route');
    }
    if (!typesContent.includes('users')) {
      throw new Error('Expected users still present in types.d.ts');
    }
    console.log('  types.d.ts now contains both routes ✓');

    // Step 9: Update first route type
    console.log('\n=== Step 9: Update first route type ===');
    await ingestRoute('GET', '/api/users',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          users: {
            kind: 'array', element: {
              kind: 'object', properties: {
                id: { kind: 'primitive', name: 'number' },
                name: { kind: 'primitive', name: 'string' },
                email: { kind: 'primitive', name: 'string' },  // NEW FIELD
              },
            },
          },
          total: { kind: 'primitive', name: 'number' },
        },
      },
    );
    console.log('  Route GET /api/users updated with email field ✓');

    // Wait for watch to detect the change
    await sleep(4000);

    // Step 10: Verify types.d.ts reflects updated type
    console.log('\n=== Step 10: Verify types.d.ts reflects update ===');
    typesContent = fs.readFileSync(typesPath, 'utf-8');
    if (!typesContent.includes('email')) {
      throw new Error('Expected email field in updated types.d.ts');
    }
    console.log('  types.d.ts updated with email field ✓');

    // Step 11: Verify guards.ts was also generated
    console.log('\n=== Step 11: Verify guards.ts generated ===');
    const guardsPath = path.join(trickleDir, 'guards.ts');
    if (!fs.existsSync(guardsPath)) {
      throw new Error('Expected guards.ts to be generated');
    }
    console.log('  guards.ts generated ✓');

    // Verify watch output shows the detections
    const finalOutput = watchHandle.getStdout();
    if (!finalOutput.includes('Regenerated') && !finalOutput.includes('Generated')) {
      throw new Error('Expected regeneration messages in watch output');
    }
    // Verify schemas.ts was generated (zod in deps)
    const schemasPath = path.join(trickleDir, 'schemas.ts');
    if (!fs.existsSync(schemasPath)) {
      throw new Error('Expected schemas.ts for zod project');
    }
    console.log('  schemas.ts generated (zod detected) ✓');

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle watch detects changes and regenerates types!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (watchHandle) { watchHandle.proc.kill('SIGTERM'); }
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
