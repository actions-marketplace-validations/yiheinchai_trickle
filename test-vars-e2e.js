/**
 * E2E test for variable-level tracing.
 * Runs a simple script with trickle/observe and checks that
 * .trickle/variables.jsonl contains captured variable observations.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TRICKLE_DIR = path.join(__dirname, '.trickle');
const VARS_FILE = path.join(TRICKLE_DIR, 'variables.jsonl');

// Clean up
try { fs.unlinkSync(VARS_FILE); } catch {}

// Create a test app that declares several variables
const testApp = path.join(__dirname, 'temp', 'test-vars-app.js');
fs.mkdirSync(path.dirname(testApp), { recursive: true });
fs.writeFileSync(testApp, `
function processOrder(orderId) {
  const price = 29.99;
  const quantity = 3;
  const total = price * quantity;
  const customer = { name: "Alice", email: "alice@example.com" };
  const items = ["widget", "gadget", "doohickey"];
  const isVip = true;
  const discount = isVip ? 0.1 : 0;
  const finalTotal = total * (1 - discount);
  return { orderId, total: finalTotal, customer };
}

const result = processOrder("ORD-123");
console.log("Order processed:", result.orderId, "total:", result.total);
`);

console.log('Running test app with trickle/observe...');

try {
  const output = execSync(
    `node -r ${path.join(__dirname, 'packages/client-js/dist/observe-register.js')} ${testApp}`,
    {
      env: {
        ...process.env,
        TRICKLE_LOCAL: '1',
        TRICKLE_LOCAL_DIR: TRICKLE_DIR,
        TRICKLE_DEBUG: '1',
      },
      timeout: 10000,
      encoding: 'utf-8',
    }
  );
  console.log('Output:', output);
} catch (err) {
  console.error('Run failed:', err.message);
  if (err.stderr) console.error('stderr:', err.stderr);
  process.exit(1);
}

// Wait a moment for flush
execSync('sleep 1');

// Check variables.jsonl
if (!fs.existsSync(VARS_FILE)) {
  console.error('FAIL: variables.jsonl not created');
  process.exit(1);
}

const content = fs.readFileSync(VARS_FILE, 'utf-8');
const lines = content.trim().split('\n').filter(Boolean);
const observations = lines.map(l => JSON.parse(l));

console.log(`\nCaptured ${observations.length} variable observations:\n`);

for (const obs of observations) {
  console.log(`  Line ${obs.line}: ${obs.varName} = ${JSON.stringify(obs.sample)} (${obs.type.kind}${obs.type.name ? ':' + obs.type.name : obs.type.properties ? ':object' : ''})`);
}

// Verify we captured the expected variables
const varNames = observations.map(o => o.varName);
const expected = ['price', 'quantity', 'total', 'customer', 'items', 'isVip', 'discount', 'finalTotal', 'result'];

let pass = true;
for (const name of expected) {
  if (!varNames.includes(name)) {
    console.error(`FAIL: Missing variable '${name}'`);
    pass = false;
  }
}

// Verify types are correct
const priceObs = observations.find(o => o.varName === 'price');
if (priceObs && priceObs.type.kind !== 'primitive') {
  console.error(`FAIL: Expected price to be primitive, got ${priceObs.type.kind}`);
  pass = false;
}

const customerObs = observations.find(o => o.varName === 'customer');
if (customerObs && customerObs.type.kind !== 'object') {
  console.error(`FAIL: Expected customer to be object, got ${customerObs.type.kind}`);
  pass = false;
}

const itemsObs = observations.find(o => o.varName === 'items');
if (itemsObs && itemsObs.type.kind !== 'array') {
  console.error(`FAIL: Expected items to be array, got ${itemsObs.type.kind}`);
  pass = false;
}

if (pass) {
  console.log('\nPASS: All expected variables captured with correct types!');
} else {
  console.error('\nFAIL: Some checks failed');
  process.exit(1);
}

// Also test the CLI vars command
console.log('\nTesting trickle vars command...');
try {
  const varsOutput = execSync(
    `node ${path.join(__dirname, 'packages/cli/dist/index.js')} vars`,
    { encoding: 'utf-8', timeout: 5000 }
  );
  console.log(varsOutput);
} catch (err) {
  console.log('CLI output:', err.stdout || err.message);
}

// Clean up
try { fs.unlinkSync(testApp); } catch {}
console.log('Done!');
