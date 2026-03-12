/**
 * E2E test: Universal function observation via `observe()`
 *
 * Verifies that observe() wraps arbitrary functions (not just Express routes)
 * and captures runtime types + sample data for every call.
 *
 * Steps:
 * 1. Starts the trickle backend
 * 2. Uses observe() to wrap a set of plain helper functions
 * 3. Calls the wrapped functions with various data shapes
 * 4. Verifies types and samples were captured in the backend
 * 5. Verifies error capture works
 */
const { spawn } = require('child_process');
const path = require('path');

const BACKEND_PORT = 4888;

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

// --- Simulate a set of helper functions (like the user's cpaE2eHelpers) ---

function getCpaStatus(accountId) {
  return Promise.resolve({
    isInCPA: true,
    cpaStatus: 'active',
    cpaPaymentAmount: 50.00,
    nextCPADueDate: '2026-04-15',
    daysFromCPA: 12,
    cpaPaymentFailed: false,
    cpaCancelled: false,
    cpaCancellationReason: null,
  });
}

function getAlerts(status) {
  return Promise.resolve({
    message: 'Account credit alerts generated successfully',
    alert: [
      {
        alertType: 'Information',
        title: 'Your next payment is coming up',
        message: `Amount: £${status.cpaPaymentAmount}, Due date: ${status.nextCPADueDate}`,
      },
    ],
  });
}

function makeManualRepayment(customerId, amountPence) {
  return Promise.resolve({
    id: 'pi_test_123',
    amount: amountPence,
    currency: 'gbp',
    status: 'succeeded',
    customer: customerId,
  });
}

function setInterestRate(loanId, rate) {
  return Promise.resolve({ loanId, previousRate: 29.9, newRate: rate });
}

function failingFunction(input) {
  return Promise.reject(new Error(`API call failed: 404 Not Found for ${input}`));
}

function syncHelper(a, b) {
  return { sum: a + b, product: a * b };
}

// ---

async function run() {
  let backendProc = null;

  try {
    // Step 1: Start the backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = spawn('node', ['../packages/backend/dist/index.js'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    backendProc.stdout.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[backend] ${d}`);
    });
    backendProc.stderr.on('data', (d) => {
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[backend-err] ${d}`);
    });

    await waitForServer(BACKEND_PORT);
    console.log('  Backend running on :' + BACKEND_PORT + ' ✓');

    // Step 2: Use observe() to wrap the helper functions
    console.log('\n=== Step 2: Wrap functions with observe() ===');

    // Need to configure transport first
    const { configure, observe, observeFn, flush } = require('../packages/client-js/dist/index.js');
    configure({
      backendUrl: `http://localhost:${BACKEND_PORT}`,
      batchIntervalMs: 500,
      enabled: true,
      debug: !!process.env.TRICKLE_DEBUG,
    });

    // Wrap all helpers at once using observe()
    const helpers = observe({
      getCpaStatus,
      getAlerts,
      makeManualRepayment,
      setInterestRate,
      failingFunction,
      syncHelper,
    }, { module: 'cpa-e2e-helpers' });

    console.log('  Wrapped 6 functions with observe() ✓');

    // Step 3: Call the wrapped functions
    console.log('\n=== Step 3: Call observed functions ===');

    const status = await helpers.getCpaStatus('acc_12345');
    console.log(`  getCpaStatus → cpaStatus: ${status.cpaStatus} ✓`);

    const alerts = await helpers.getAlerts(status);
    console.log(`  getAlerts → ${alerts.alert.length} alert(s) ✓`);

    const payment = await helpers.makeManualRepayment('cus_test', 1000);
    console.log(`  makeManualRepayment → status: ${payment.status} ✓`);

    const rateResult = await helpers.setInterestRate('loan_789', 0);
    console.log(`  setInterestRate → newRate: ${rateResult.newRate} ✓`);

    const syncResult = helpers.syncHelper(3, 7);
    console.log(`  syncHelper → sum: ${syncResult.sum}, product: ${syncResult.product} ✓`);

    // Test error capture
    try {
      await helpers.failingFunction('user/999');
    } catch (err) {
      console.log(`  failingFunction → caught error: "${err.message}" ✓`);
    }

    // Also test observeFn for a single function
    const tracedSync = observeFn(syncHelper, { module: 'standalone', name: 'syncHelper' });
    tracedSync(10, 20);
    console.log('  observeFn (standalone) → called ✓');

    // Step 4: Wait for flush
    console.log('\n=== Step 4: Flush and verify ===');
    await flush();
    await sleep(2000);

    // Step 5: Query backend for captured functions
    console.log('\n=== Step 5: Verify types captured in backend ===');
    let resp = await fetch(`http://localhost:${BACKEND_PORT}/api/functions`);
    const functionsData = await resp.json();
    const functions = functionsData.functions;

    console.log(`  Total functions observed: ${functions.length}`);
    if (functions.length === 0) {
      throw new Error('No functions captured!');
    }

    const functionNames = functions.map(f => f.function_name);
    console.log(`  Function names: ${functionNames.join(', ')}`);

    // Verify all expected functions were captured
    const expectedFunctions = [
      'getCpaStatus',
      'getAlerts',
      'makeManualRepayment',
      'setInterestRate',
      'failingFunction',
      'syncHelper',
    ];
    for (const name of expectedFunctions) {
      if (functionNames.includes(name)) {
        console.log(`  Function "${name}" captured ✓`);
      } else {
        throw new Error(`Function "${name}" NOT captured! Found: ${functionNames.join(', ')}`);
      }
    }

    // Step 6: Verify type snapshots have sample data
    console.log('\n=== Step 6: Verify type snapshots + samples ===');

    // Find getCpaStatus and check its type snapshot
    const getCpaFn = functions.find(f => f.function_name === 'getCpaStatus');
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/types/${getCpaFn.id}`);
    const typesData = await resp.json();
    const snapshots = typesData.snapshots;

    if (snapshots.length === 0) {
      throw new Error('No type snapshots for getCpaStatus!');
    }

    const snapshot = snapshots[0];

    // Verify return type has the right shape
    const returnType = snapshot.return_type;
    if (returnType.kind !== 'object') {
      throw new Error(`Expected object return type, got: ${returnType.kind}`);
    }

    const returnProps = Object.keys(returnType.properties || {});
    const expectedProps = ['isInCPA', 'cpaStatus', 'cpaPaymentAmount', 'nextCPADueDate'];
    for (const prop of expectedProps) {
      if (returnProps.includes(prop)) {
        console.log(`  getCpaStatus returnType.${prop} ✓`);
      } else {
        throw new Error(`Missing return type property: ${prop}. Found: ${returnProps.join(', ')}`);
      }
    }

    // Verify sample output exists
    if (snapshot.sample_output) {
      const sample = snapshot.sample_output;
      if (sample.cpaStatus === 'active' && sample.cpaPaymentAmount === 50) {
        console.log('  getCpaStatus sample output matches ✓');
      } else {
        console.log(`  getCpaStatus sample output: ${JSON.stringify(sample)}`);
      }
    }

    // Verify sample input exists
    if (snapshot.sample_input) {
      console.log(`  getCpaStatus sample input: ${JSON.stringify(snapshot.sample_input)} ✓`);
    }

    // Step 7: Verify error was captured
    console.log('\n=== Step 7: Verify error capture ===');
    resp = await fetch(`http://localhost:${BACKEND_PORT}/api/errors`);
    const errorsData = await resp.json();
    const errors = errorsData.errors;

    const observeErrors = errors.filter(e => {
      const fn = functions.find(f => f.id === e.function_id);
      return fn && fn.function_name === 'failingFunction';
    });

    if (observeErrors.length > 0) {
      const err = observeErrors[0];
      console.log(`  Error captured for failingFunction: "${err.error_message}" ✓`);
      if (err.error_type === 'Error') {
        console.log('  Error type: Error ✓');
      }
    } else {
      throw new Error('No error captured for failingFunction!');
    }

    // Step 8: Verify module grouping
    console.log('\n=== Step 8: Verify module grouping ===');
    const modules = new Set(functions.map(f => f.module));
    console.log(`  Modules: ${[...modules].join(', ')}`);
    if (modules.has('cpa-e2e-helpers')) {
      console.log('  Module "cpa-e2e-helpers" present ✓');
    } else {
      throw new Error('Module "cpa-e2e-helpers" not found!');
    }

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('Universal function observation works end-to-end!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (backendProc) {
      backendProc.kill('SIGTERM');
      await sleep(500);
    }
    process.exit(process.exitCode || 0);
  }
}

run();
