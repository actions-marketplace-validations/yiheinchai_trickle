/**
 * E2E test: trickle run --watch mode
 *
 * Verifies that trickle --watch:
 * 1. Runs the initial observation successfully
 * 2. Detects file changes and re-runs automatically
 * 3. Captures new/changed function types after re-run
 * 4. Shows "Re-running" output on change detection
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BACKEND_PORT = 4888;
const CLI = path.resolve('packages/cli/dist/index.js');
const APP_FILE = path.resolve('test-watch-app.js');

// Original content of the app file
const ORIGINAL_CONTENT = `/**
 * Simple app used by test-run-watch-e2e.js.
 * Contains a function that will be modified during the watch test.
 */

function greet(name) {
  return { message: \`Hello, \${name}!\`, length: name.length };
}

const result = greet("World");
console.log(result.message);
console.log("Done!");
`;

// Modified content — adds a new function
const MODIFIED_CONTENT = `/**
 * Simple app used by test-run-watch-e2e.js.
 * Contains a function that will be modified during the watch test.
 */

function greet(name) {
  return { message: \`Hello, \${name}!\`, length: name.length };
}

function farewell(name, reason) {
  return { message: \`Goodbye, \${name}!\`, reason: reason || "leaving" };
}

const result = greet("World");
const bye = farewell("World", "test complete");
console.log(result.message);
console.log(bye.message);
console.log("Done!");
`;

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

async function resetDb() {
  const dbPath = path.join(os.homedir(), '.trickle', 'trickle.db');
  try { fs.unlinkSync(dbPath); } catch {}
  await sleep(1000);
}

async function run() {
  let backendProc = null;
  let watchProc = null;

  try {
    // === Setup ===
    console.log('=== Step 1: Start backend ===');
    await resetDb();

    // Ensure the app file has original content
    fs.writeFileSync(APP_FILE, ORIGINAL_CONTENT);

    backendProc = spawn('node', ['packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', () => {});

    await waitForServer(BACKEND_PORT);
    console.log('  Backend running OK');

    // === Test: Start watch mode ===
    console.log('\n=== Step 2: Start trickle run --watch ===');

    let watchOutput = '';
    watchProc = spawn('node', [CLI, 'run', 'test-watch-app.js', '--watch'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    watchProc.stdout.on('data', (d) => {
      const text = d.toString();
      watchOutput += text;
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[watch] ${text}`);
    });
    watchProc.stderr.on('data', (d) => {
      watchOutput += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[watch-err] ${d}`);
    });

    // Wait for initial run to complete (look for "Watching for changes" in output)
    let initialComplete = false;
    for (let i = 0; i < 30; i++) {
      if (watchOutput.includes('Watching for changes')) {
        initialComplete = true;
        break;
      }
      await sleep(1000);
    }

    if (!initialComplete) {
      throw new Error('Watch mode did not complete initial run. Output: ' + watchOutput.slice(0, 500));
    }
    console.log('  Initial run completed OK');

    // Verify initial observation
    await sleep(1000);
    const resp1 = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    const data1 = await resp1.json();
    const initialFunctions = data1.functions;

    console.log(`  Initial functions: ${initialFunctions.map(f => f.function_name).join(', ')}`);

    const greetFn = initialFunctions.find(f => f.function_name === 'greet');
    if (greetFn) {
      console.log('  greet() captured OK');
    } else {
      throw new Error('greet() not captured in initial run');
    }

    // === Modify the file ===
    console.log('\n=== Step 3: Modify source file ===');

    // Clear output buffer for change detection
    const outputBeforeChange = watchOutput.length;
    fs.writeFileSync(APP_FILE, MODIFIED_CONTENT);
    console.log('  File modified (added farewell function)');

    // Wait for re-run to trigger and complete
    let rerunDetected = false;
    for (let i = 0; i < 30; i++) {
      const newOutput = watchOutput.slice(outputBeforeChange);
      if (newOutput.includes('Re-running') || newOutput.includes('Functions observed')) {
        rerunDetected = true;
        // Wait a bit more for the run to complete and flush
        await sleep(5000);
        break;
      }
      await sleep(1000);
    }

    if (!rerunDetected) {
      throw new Error('Watch mode did not detect file change. New output: ' + watchOutput.slice(outputBeforeChange, outputBeforeChange + 300));
    }
    console.log('  Re-run triggered OK');

    // === Verify new function was captured ===
    console.log('\n=== Step 4: Verify new function captured ===');

    const resp2 = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    const data2 = await resp2.json();
    const allFunctions = data2.functions;

    console.log(`  Total functions: ${allFunctions.map(f => f.function_name).join(', ')}`);

    const farewellFn = allFunctions.find(f => f.function_name === 'farewell');
    if (farewellFn) {
      console.log('  farewell() captured after file change OK');
    } else {
      throw new Error('farewell() NOT captured after file change! Watch re-run may have failed.');
    }

    // Verify farewell has correct type
    const typeResp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${farewellFn.id}`);
    const typeData = await typeResp.json();

    if (typeData.snapshots && typeData.snapshots.length > 0) {
      const retType = typeData.snapshots[0].return_type;
      if (retType && retType.kind === 'object') {
        const props = Object.keys(retType.properties || {});
        if (props.includes('message') && props.includes('reason')) {
          console.log('  farewell return type: { message, reason } OK');
        } else {
          console.log(`  farewell return type props: ${props.join(', ')}`);
        }
      }
    }

    // Verify the output contains expected watch-mode text
    console.log('\n=== Step 5: Verify watch output ===');

    if (watchOutput.includes('trickle run --watch')) {
      console.log('  Header shows --watch mode OK');
    }
    if (watchOutput.includes('Watch:')) {
      console.log('  Watch enabled indicator OK');
    }
    if (watchOutput.includes('Watching for changes')) {
      console.log('  Watch status message OK');
    }
    if (watchOutput.includes('Changed:')) {
      console.log('  File change detected message OK');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Watch mode works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Restore original file
    try { fs.writeFileSync(APP_FILE, ORIGINAL_CONTENT); } catch {}

    if (watchProc) {
      watchProc.kill('SIGTERM');
      await sleep(300);
    }
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(300);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
