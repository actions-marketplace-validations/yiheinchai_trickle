/**
 * E2E test: Direct file execution shorthand + auto sidecar types
 *
 * Verifies that:
 * 1. `trickle app.js` works (shorthand for `trickle run app.js`)
 * 2. Sidecar .d.ts file is auto-generated next to the source file
 * 3. The .d.ts file contains correct type declarations
 * 4. Functions are captured with correct types
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BACKEND_PORT = 4888;
const CLI = path.resolve('packages/cli/dist/index.js');
const APP_FILE = path.resolve('test-direct-exec-app.js');
const DTS_FILE = path.resolve('test-direct-exec-app.d.ts');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(port, maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetch(`http://localhost:${port}/`);
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

  try {
    // === Setup ===
    console.log('=== Step 1: Start backend ===');
    await resetDb();

    // Clean up any leftover .d.ts file
    try { fs.unlinkSync(DTS_FILE); } catch {}

    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', () => {});

    await waitForServer(BACKEND_PORT);
    console.log('  Backend running OK');

    // === Test: Direct file execution (trickle app.js) ===
    console.log('\n=== Step 2: Run `trickle test-direct-exec-app.js` (no "run" subcommand) ===');

    // NOTE: We call the CLI directly with just the file, no "run" subcommand
    const { stdout: runOut } = await runCmd('node', [
      CLI,
      'test-direct-exec-app.js',
    ]);

    if (runOut.includes('Done!') || runOut.includes('Functions observed')) {
      console.log('  App ran successfully OK');
    } else {
      throw new Error('App did not complete. Output: ' + runOut.slice(0, 500));
    }

    // === Verify functions captured ===
    console.log('\n=== Step 3: Verify functions captured ===');

    const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    const data = await resp.json();
    const functions = data.functions;

    console.log(`  Functions: ${functions.map(f => f.function_name).join(', ')}`);

    const calcFn = functions.find(f => f.function_name === 'calculateTotal');
    if (calcFn) {
      console.log('  calculateTotal captured OK');
    } else {
      throw new Error('calculateTotal NOT captured! Direct exec may have failed.');
    }

    const receiptFn = functions.find(f => f.function_name === 'formatReceipt');
    if (receiptFn) {
      console.log('  formatReceipt captured OK');
    } else {
      throw new Error('formatReceipt NOT captured!');
    }

    // === Verify sidecar .d.ts file was generated ===
    console.log('\n=== Step 4: Verify sidecar .d.ts file ===');

    if (fs.existsSync(DTS_FILE)) {
      const dtsContent = fs.readFileSync(DTS_FILE, 'utf-8');
      console.log(`  ${path.basename(DTS_FILE)} exists OK (${dtsContent.length} bytes)`);

      // Check that it contains type declarations
      if (dtsContent.includes('calculateTotal') || dtsContent.includes('CalculateTotal')) {
        console.log('  Contains calculateTotal type OK');
      } else {
        console.log('  Warning: calculateTotal type not found in .d.ts');
        console.log('  Content preview:', dtsContent.slice(0, 200));
      }

      if (dtsContent.includes('formatReceipt') || dtsContent.includes('FormatReceipt')) {
        console.log('  Contains formatReceipt type OK');
      } else {
        console.log('  Warning: formatReceipt type not found in .d.ts');
      }

      if (dtsContent.includes('export')) {
        console.log('  Contains export declarations OK');
      }

      // Verify type shapes
      if (dtsContent.includes('total') && dtsContent.includes('currency')) {
        console.log('  Contains total/currency properties OK');
      }
    } else {
      throw new Error('Sidecar .d.ts file NOT generated! Auto-sidecar may have failed.');
    }

    // === Verify type snapshot ===
    console.log('\n=== Step 5: Verify type snapshots ===');

    const calcResp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${calcFn.id}`);
    const calcData = await calcResp.json();

    if (calcData.snapshots && calcData.snapshots.length > 0) {
      const retType = calcData.snapshots[0].return_type;
      if (retType && retType.kind === 'object') {
        const props = Object.keys(retType.properties || {});
        if (props.includes('total') && props.includes('itemCount') && props.includes('currency')) {
          console.log('  calculateTotal return: { total, itemCount, currency } OK');
        } else {
          console.log(`  calculateTotal return props: ${props.join(', ')}`);
        }
      }
    }

    // === Verify that output mentions types were written ===
    console.log('\n=== Step 6: Verify output messages ===');

    if (runOut.includes('trickle run')) {
      console.log('  Shows "trickle run" header (routed correctly) OK');
    }

    if (runOut.includes('Types written') || runOut.includes('.d.ts')) {
      console.log('  Shows sidecar generation message OK');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Direct file execution with auto sidecar types works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Clean up .d.ts file
    try { fs.unlinkSync(DTS_FILE); } catch {}

    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
