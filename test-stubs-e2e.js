/**
 * E2E test: trickle stubs
 *
 * Verifies that `trickle stubs <dir>` generates .d.ts and .pyi sidecar
 * type stub files next to source files, based on observed runtime types.
 *
 * Steps:
 * 1. Start backend
 * 2. Create a temp directory with JS and Python source files
 * 3. Observe the JS functions via trickle run
 * 4. Run trickle stubs on the temp directory — verify .d.ts created
 * 5. Observe Python functions
 * 6. Run trickle stubs again — verify .pyi created
 * 7. Test --dry-run mode
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
    setTimeout(() => reject(new Error('Timed out')), 30000);
  });
}

async function resetDb() {
  const dbPath = path.join(os.homedir(), '.trickle', 'trickle.db');
  try { fs.unlinkSync(dbPath); } catch {}
  await sleep(1000);
}

async function run() {
  let backendProc = null;
  // Create a temp project dir to test stubs generation
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trickle-stubs-'));

  try {
    // === Setup: create source files in temp dir ===
    // JS helpers — must also be in project root for trickle run to observe them
    const jsHelpersContent = `
function greetUser(user) {
  return { message: 'Hello ' + user.name, timestamp: Date.now() };
}

function sumPrices(items) {
  const total = items.reduce((s, i) => s + i.price, 0);
  return { total, count: items.length };
}

module.exports = { greetUser, sumPrices };
`;
    const jsAppContent = `
const helpers = require('./stubs-test-helpers');
const result = helpers.greetUser({ name: 'Alice', age: 30 });
console.log(result);
const totals = helpers.sumPrices([{ name: 'A', price: 10 }, { name: 'B', price: 20.5 }]);
console.log(totals);
console.log('Done!');
`;

    // Write helpers both in project root (for require) and tmp dir (for stubs)
    fs.writeFileSync(path.resolve('stubs-test-helpers.js'), jsHelpersContent);
    fs.writeFileSync(path.resolve('stubs-test-app.js'), jsAppContent);
    // Also write to tmp dir for the stubs command to find
    fs.writeFileSync(path.join(tmpDir, 'stubs-test-helpers.js'), jsHelpersContent);

    // Python helpers
    const pyHelpersContent = `"""Test helpers for stubs e2e."""


def greet_user(user):
    return {"message": "Hello " + user["name"], "timestamp": 12345}


def sum_prices(items):
    total = sum(i["price"] for i in items)
    return {"total": total, "count": len(items)}
`;
    // Write importable Python module in project root
    fs.writeFileSync(path.resolve('stubs_test_helpers.py'), pyHelpersContent);
    // Write to tmp dir for stubs to find
    fs.writeFileSync(path.join(tmpDir, 'stubs_test_helpers.py'), pyHelpersContent);

    // === Step 1: Start backend ===
    console.log('=== Step 1: Start backend ===');
    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', () => {});
    await waitForServer(BACKEND_PORT);
    console.log('  Backend running ✓');

    // === Step 2: Observe JS functions ===
    console.log('\n=== Step 2: Observe JS functions ===');
    await runCmd('node', [CLI, 'run', 'node stubs-test-app.js']);
    await sleep(3000);

    let resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    let data = await resp.json();
    const jsFunctions = data.functions.filter(f => f.module === 'stubs-test-helpers');
    console.log(`  Captured ${jsFunctions.length} JS functions ✓`);
    if (jsFunctions.length < 2) throw new Error(`Expected ≥2 JS functions, got ${jsFunctions.length}`);

    // === Step 3: Generate stubs for JS ===
    console.log('\n=== Step 3: Generate JS stubs ===');
    await runCmd('node', [CLI, 'stubs', tmpDir]);

    const dtsPath = path.join(tmpDir, 'stubs-test-helpers.d.ts');
    if (!fs.existsSync(dtsPath)) {
      throw new Error(`.d.ts file not created at ${dtsPath}`);
    }

    const dtsContent = fs.readFileSync(dtsPath, 'utf-8');
    console.log('  .d.ts file created ✓');

    // Verify content
    if (!dtsContent.includes('GreetUser') && !dtsContent.includes('greetUser')) {
      throw new Error('.d.ts missing greetUser types');
    }
    console.log('  .d.ts contains greetUser types ✓');

    if (!dtsContent.includes('SumPrices') && !dtsContent.includes('sumPrices')) {
      throw new Error('.d.ts missing sumPrices types');
    }
    console.log('  .d.ts contains sumPrices types ✓');

    if (dtsContent.includes('export interface') || dtsContent.includes('export type') || dtsContent.includes('export declare function')) {
      console.log('  .d.ts has proper TypeScript declarations ✓');
    } else {
      throw new Error('.d.ts missing TypeScript declarations');
    }

    // Print sample
    const dtsLines = dtsContent.split('\n').filter(l => l.startsWith('export'));
    for (const line of dtsLines.slice(0, 5)) {
      console.log(`  ${line}`);
    }

    // === Step 4: Observe Python functions ===
    console.log('\n=== Step 4: Observe Python functions ===');

    const PYTHONPATH = [
      path.resolve('packages/client-python/src'),
      path.resolve('.'),
    ].join(':');

    const pyScript = `
import sys, os
sys.path.insert(0, os.path.join("${path.resolve('.')}", "packages", "client-python", "src"))
sys.path.insert(0, "${path.resolve('.')}")
from trickle import observe, configure
configure(backend_url="http://localhost:${BACKEND_PORT}")
import stubs_test_helpers as raw
helpers = observe(raw, module="stubs_test_helpers")
r1 = helpers.greet_user({"name": "Bob", "age": 25})
r2 = helpers.sum_prices([{"name": "X", "price": 15}, {"name": "Y", "price": 25.5}])
import time; time.sleep(3)
print("Done!")
`;
    const pyRunnerPath = path.resolve('stubs-test-py-runner.py');
    fs.writeFileSync(pyRunnerPath, pyScript);

    await runCmd('python3', [pyRunnerPath], {
      PYTHONPATH,
      TRICKLE_BACKEND_URL: `http://localhost:${BACKEND_PORT}`,
    });
    await sleep(3000);

    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    data = await resp.json();
    const pyFunctions = data.functions.filter(f => f.module === 'stubs_test_helpers');
    console.log(`  Captured ${pyFunctions.length} Python functions ✓`);
    if (pyFunctions.length < 2) throw new Error(`Expected ≥2 Python functions, got ${pyFunctions.length}`);

    // === Step 5: Generate stubs for Python ===
    console.log('\n=== Step 5: Generate Python stubs ===');
    await runCmd('node', [CLI, 'stubs', tmpDir]);

    const pyiPath = path.join(tmpDir, 'stubs_test_helpers.pyi');
    if (!fs.existsSync(pyiPath)) {
      throw new Error(`.pyi file not created at ${pyiPath}`);
    }

    const pyiContent = fs.readFileSync(pyiPath, 'utf-8');
    console.log('  .pyi file created ✓');

    if (!pyiContent.includes('GreetUser') && !pyiContent.includes('greet_user')) {
      throw new Error('.pyi missing greet_user types');
    }
    console.log('  .pyi contains greet_user types ✓');

    if (pyiContent.includes('TypedDict') || pyiContent.includes('class ')) {
      console.log('  .pyi has proper Python type stubs ✓');
    } else {
      throw new Error('.pyi missing TypedDict definitions');
    }

    // Print sample
    const pyiLines = pyiContent.split('\n').filter(l => l.startsWith('class ') || l.startsWith('def '));
    for (const line of pyiLines.slice(0, 5)) {
      console.log(`  ${line}`);
    }

    // === Step 6: Test --dry-run ===
    console.log('\n=== Step 6: Test --dry-run ===');
    // Delete stubs first
    try { fs.unlinkSync(dtsPath); } catch {}
    try { fs.unlinkSync(pyiPath); } catch {}

    const { stdout: dryOut } = await runCmd('node', [CLI, 'stubs', tmpDir, '--dry-run']);

    if (fs.existsSync(dtsPath) || fs.existsSync(pyiPath)) {
      throw new Error('--dry-run should not create files!');
    }
    console.log('  --dry-run did not create files ✓');

    if (dryOut.includes('Would create') || dryOut.includes('Dry run')) {
      console.log('  --dry-run output correct ✓');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle stubs works end-to-end for JS and Python!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(path.resolve('stubs-test-helpers.js')); } catch {}
    try { fs.unlinkSync(path.resolve('stubs-test-app.js')); } catch {}
    try { fs.unlinkSync(path.resolve('stubs_test_helpers.py')); } catch {}
    try { fs.unlinkSync(path.resolve('stubs-test-py-runner.py')); } catch {}

    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(500);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
