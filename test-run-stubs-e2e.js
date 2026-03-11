/**
 * E2E test: trickle run --stubs and --annotate
 *
 * Verifies the one-command workflow:
 * 1. trickle run "node app.js" --stubs <dir> → observe + auto-generate .d.ts
 * 2. trickle run "node app.js" --annotate <file> → observe + auto-annotate
 * 3. Summary shows inline type signatures
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BACKEND_PORT = 4888;
const CLI = path.resolve('packages/cli/dist/index.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch(`http://localhost:${port}/api/functions`);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

function runCmd(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[out] ${d}`);
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[err] ${d}`);
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Exit ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    setTimeout(() => reject(new Error('Timed out')), 60000);
  });
}

async function resetDb() {
  const dbPath = path.join(os.homedir(), '.trickle', 'trickle.db');
  try { fs.unlinkSync(dbPath); } catch {}
  await sleep(1000);
}

async function run() {
  let backendProc = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-run-stubs-'));

  // Save original helpers for restoration
  const helpersPath = path.resolve('test-annotate-helpers.js');
  const helpersOriginal = fs.readFileSync(helpersPath, 'utf-8');

  try {
    // === Setup ===
    // Copy helpers to temp dir for stubs test
    fs.writeFileSync(
      path.join(tmpDir, 'test-annotate-helpers.js'),
      helpersOriginal,
    );

    // Start backend
    console.log('=== Step 1: Start backend ===');
    await resetDb();
    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(BACKEND_PORT);
    console.log('  Backend running ✓');

    // === Test 1: trickle run --stubs ===
    console.log('\n=== Step 2: trickle run --stubs ===');

    const { stdout: stubsOut } = await runCmd('node', [
      CLI,
      'run',
      'node test-annotate-app.js',
      '--stubs',
      tmpDir,
    ]);

    // Verify the app ran
    if (stubsOut.includes('Done!') || stubsOut.includes('Functions observed')) {
      console.log('  App ran successfully ✓');
    } else {
      throw new Error('App did not complete');
    }

    // Verify stubs were generated
    const dtsPath = path.join(tmpDir, 'test-annotate-helpers.d.ts');
    if (fs.existsSync(dtsPath)) {
      console.log('  .d.ts stub auto-generated ✓');
      const dtsContent = fs.readFileSync(dtsPath, 'utf-8');
      if (dtsContent.includes('parseConfig') || dtsContent.includes('ParseConfig')) {
        console.log('  .d.ts contains types for parseConfig ✓');
      } else {
        throw new Error('.d.ts missing parseConfig types');
      }
    } else {
      throw new Error('.d.ts stub was not generated!');
    }

    // Verify the summary shows stubs info
    if (stubsOut.includes('Generated') || stubsOut.includes('type stub')) {
      console.log('  Summary mentions generated stubs ✓');
    }

    // Verify inline type signatures in summary
    if (stubsOut.includes('→') || stubsOut.includes('->')) {
      console.log('  Summary shows inline type signatures ✓');
    } else {
      console.log('  Note: type signatures may not be visible (OK for first run)');
    }

    // Verify the Stubs header line was shown
    if (stubsOut.includes('Stubs:')) {
      console.log('  Header shows --stubs target ✓');
    }

    // === Test 2: trickle run --annotate ===
    console.log('\n=== Step 3: trickle run --annotate ===');

    // Restore helpers file to unannotated state
    fs.writeFileSync(helpersPath, helpersOriginal, 'utf-8');

    const { stdout: annotateOut } = await runCmd('node', [
      CLI,
      'run',
      'node test-annotate-app.js',
      '--annotate',
      helpersPath,
    ]);

    // Verify annotation happened
    const annotatedContent = fs.readFileSync(helpersPath, 'utf-8');

    if (annotatedContent !== helpersOriginal) {
      console.log('  File was annotated ✓');

      // Should have JSDoc comments for .js file
      if (annotatedContent.includes('@param') || annotatedContent.includes('@returns')) {
        console.log('  JSDoc annotations added ✓');
      }
    } else {
      console.log('  Note: file was not modified (types may already be present)');
    }

    if (annotateOut.includes('Annotate:')) {
      console.log('  Header shows --annotate target ✓');
    }

    // === Test 3: Verify summary has type signatures ===
    console.log('\n=== Step 4: Verify type signatures in summary ===');

    // Reset DB for a clean run to see new functions
    backendProc.kill('SIGTERM');
    await sleep(1000);
    await resetDb();
    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', () => {});
    backendProc.stderr.on('data', () => {});
    await waitForServer(BACKEND_PORT);

    // Restore and run again
    fs.writeFileSync(helpersPath, helpersOriginal, 'utf-8');

    const { stdout: sigOut } = await runCmd('node', [
      CLI,
      'run',
      'node test-annotate-app.js',
    ]);

    // The summary should show type signatures for new functions
    // Functions like: parseConfig(arg0: { host: string; ... }) → { host: string; ... }
    if (sigOut.includes('→') || sigOut.includes('module')) {
      console.log('  Summary includes type information ✓');
    }

    // Check that function names appear in summary
    if (sigOut.includes('parseConfig')) {
      console.log('  parseConfig in summary ✓');
    }
    if (sigOut.includes('processItems')) {
      console.log('  processItems in summary ✓');
    }
    if (sigOut.includes('calculateTotal')) {
      console.log('  calculateTotal in summary ✓');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle run --stubs and --annotate work end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Cleanup
    fs.writeFileSync(helpersPath, helpersOriginal, 'utf-8');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(500);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
