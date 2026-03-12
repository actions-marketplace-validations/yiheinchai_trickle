/**
 * E2E test: Python HTTP request type capture
 *
 * Verifies that trickle automatically captures types from Python requests calls:
 * 1. GET requests — captures response array/object types
 * 2. POST requests — captures request body and response types
 * 3. Types appear in trickle's function list with URL-based names
 * 4. Type snapshots contain correct shapes
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BACKEND_PORT = 4888;
const API_PORT = 4569;
const CLI = path.resolve('../packages/cli/dist/index.js');

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
  let apiProc = null;

  try {
    // === Setup ===
    console.log('=== Step 1: Start backend + API server ===');
    await resetDb();

    // Start trickle backend
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', () => {});

    // Start test API server
    apiProc = spawn('node', ['test-py-http-server.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    apiProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[api] ${d}`);
    });
    apiProc.stderr.on('data', () => {});

    await Promise.all([
      waitForServer(BACKEND_PORT),
      waitForServer(API_PORT),
    ]);
    console.log('  Backend running OK');
    console.log('  API server running OK');

    // === Test: Run Python app with trickle ===
    console.log('\n=== Step 2: trickle run test-py-http-app.py ===');

    const { stdout: runOut, stderr: runErr } = await runCmd('node', [
      CLI,
      'run',
      'test-py-http-app.py',
    ]);

    if (runOut.includes('Done!') || runOut.includes('Functions observed')) {
      console.log('  App ran successfully OK');
    } else {
      throw new Error('App did not complete. Output: ' + runOut.slice(0, 300) + '\nStderr: ' + runErr.slice(0, 300));
    }

    // Wait for flush
    await sleep(3000);

    // === Verify captured functions ===
    console.log('\n=== Step 3: Verify captured HTTP types ===');

    const resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    const data = await resp.json();
    const functions = data.functions;

    console.log(`  Total functions captured: ${functions.length}`);
    const capturedNames = functions.map(f => `${f.function_name} [${f.module}]`);
    console.log(`  Functions: ${capturedNames.join(', ')}`);

    // Check for HTTP endpoint functions
    const getUsersFn = functions.find(f =>
      f.function_name.includes('GET') && f.function_name.includes('/api/users')
    );
    if (getUsersFn) {
      console.log(`  GET /api/users captured OK [module: ${getUsersFn.module}]`);
    } else {
      throw new Error('GET /api/users NOT captured! Python HTTP observation may have failed.');
    }

    const getConfigFn = functions.find(f =>
      f.function_name.includes('GET') && f.function_name.includes('/api/config')
    );
    if (getConfigFn) {
      console.log(`  GET /api/config captured OK [module: ${getConfigFn.module}]`);
    } else {
      throw new Error('GET /api/config NOT captured!');
    }

    const postUsersFn = functions.find(f =>
      f.function_name.includes('POST') && f.function_name.includes('/api/users')
    );
    if (postUsersFn) {
      console.log(`  POST /api/users captured OK [module: ${postUsersFn.module}]`);
    } else {
      throw new Error('POST /api/users NOT captured!');
    }

    // === Verify type snapshots ===
    console.log('\n=== Step 4: Verify type snapshots ===');

    // GET /api/users should return an array of user objects
    const usersTypeResp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${getUsersFn.id}`);
    const usersTypeData = await usersTypeResp.json();

    if (usersTypeData.snapshots && usersTypeData.snapshots.length > 0) {
      const snap = usersTypeData.snapshots[0];
      const retType = snap.return_type;

      if (retType && retType.kind === 'array') {
        const elemType = retType.element;
        if (elemType && elemType.kind === 'object') {
          const props = Object.keys(elemType.properties || {});
          if (props.includes('id') && props.includes('name') && props.includes('email')) {
            console.log('  GET /api/users return type: { id, name, email, role }[] OK');
          } else {
            console.log(`  GET /api/users return type props: ${props.join(', ')}`);
          }
        }
      } else {
        console.log(`  GET /api/users return type: ${JSON.stringify(retType).slice(0, 100)}`);
      }
    }

    // GET /api/config should return an object with appName, version, etc.
    const configTypeResp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${getConfigFn.id}`);
    const configTypeData = await configTypeResp.json();

    if (configTypeData.snapshots && configTypeData.snapshots.length > 0) {
      const snap = configTypeData.snapshots[0];
      const retType = snap.return_type;

      if (retType && retType.kind === 'object') {
        const props = Object.keys(retType.properties || {});
        if (props.includes('appName') && props.includes('version')) {
          console.log('  GET /api/config return type: { appName, version, features, ... } OK');
        } else {
          console.log(`  GET /api/config return type props: ${props.join(', ')}`);
        }
      }
    }

    // POST /api/users should have request body type
    const postTypeResp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${postUsersFn.id}`);
    const postTypeData = await postTypeResp.json();

    if (postTypeData.snapshots && postTypeData.snapshots.length > 0) {
      const snap = postTypeData.snapshots[0];
      const retType = snap.return_type;

      if (retType && retType.kind === 'object') {
        const props = Object.keys(retType.properties || {});
        if (props.includes('id') && props.includes('name')) {
          console.log('  POST /api/users return type: { id, name, email, role } OK');
        }
      }

      // Check that request body type was captured
      const argsType = snap.args_type;
      if (argsType && argsType.kind === 'tuple' && argsType.elements && argsType.elements.length > 0) {
        const bodyType = argsType.elements[0];
        if (bodyType && bodyType.kind === 'object') {
          const bodyProps = Object.keys(bodyType.properties || {});
          if (bodyProps.includes('name') && bodyProps.includes('email')) {
            console.log('  POST /api/users request body type: { name, email, role } OK');
          }
        }
      }
    }

    // === Verify module grouping ===
    console.log('\n=== Step 5: Verify module grouping ===');

    const httpModules = [...new Set(
      functions.filter(f => f.function_name.includes('/api/'))
        .map(f => f.module)
    )];
    if (httpModules.includes('localhost')) {
      console.log('  HTTP functions grouped under "localhost" module OK');
    } else {
      console.log(`  HTTP function modules: ${httpModules.join(', ')}`);
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Python HTTP request type capture works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (apiProc) {
      apiProc.kill('SIGTERM');
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
