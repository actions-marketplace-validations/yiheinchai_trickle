/**
 * E2E test: `trickle codegen --json-schema` — JSON Schema generation
 *
 * Tests:
 * 1. Start trickle backend
 * 2. Ingest sample routes with types
 * 3. Generate JSON Schema via CLI (--json-schema flag)
 * 4. Verify valid JSON with $schema field
 * 5. Verify $defs contains request schemas for POST/PUT
 * 6. Verify $defs contains response schemas for all routes
 * 7. Verify object property types (string, number, boolean)
 * 8. Verify array type handling
 * 9. Verify required fields
 * 10. Verify backend API directly (format=json-schema)
 * 11. Validate generated schema with ajv-style structural checks
 * 12. Clean shutdown
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
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

async function run() {
  let backendProc = null;

  try {
    // Step 1: Start backend
    console.log('=== Step 1: Start trickle backend ===');
    backendProc = await startBackend();
    console.log('  Backend running ✓');

    // Step 2: Ingest sample routes
    console.log('\n=== Step 2: Ingest sample route data ===');

    // GET /api/users — returns array of users
    await ingestRoute('GET', '/api/users',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          users: {
            kind: 'array', element: {
              kind: 'object', properties: {
                id: { kind: 'primitive', name: 'number' },
                name: { kind: 'primitive', name: 'string' },
                active: { kind: 'primitive', name: 'boolean' },
              },
            },
          },
          total: { kind: 'primitive', name: 'number' },
        },
      },
    );

    // POST /api/users — create user with body
    await ingestRoute('POST', '/api/users',
      {
        kind: 'object', properties: {
          body: {
            kind: 'object', properties: {
              name: { kind: 'primitive', name: 'string' },
              email: { kind: 'primitive', name: 'string' },
              age: { kind: 'primitive', name: 'number' },
            },
          },
        },
      },
      {
        kind: 'object', properties: {
          id: { kind: 'primitive', name: 'number' },
          created: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    // PUT /api/users/:id
    await ingestRoute('PUT', '/api/users/:id',
      {
        kind: 'object', properties: {
          body: {
            kind: 'object', properties: {
              name: { kind: 'primitive', name: 'string' },
              email: { kind: 'primitive', name: 'string' },
            },
          },
        },
      },
      {
        kind: 'object', properties: {
          updated: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    // DELETE /api/users/:id
    await ingestRoute('DELETE', '/api/users/:id',
      { kind: 'object', properties: {} },
      {
        kind: 'object', properties: {
          success: { kind: 'primitive', name: 'boolean' },
        },
      },
    );

    await sleep(500);
    console.log('  4 routes ingested (1 GET, 1 POST, 1 PUT, 1 DELETE) ✓');

    // Step 3: Generate JSON Schema via CLI
    console.log('\n=== Step 3: Generate JSON Schema via CLI ===');
    const schemaOutput = execSync(
      'npx trickle codegen --json-schema',
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    console.log('  JSON Schema generated via --json-schema flag ✓');

    // Step 4: Verify valid JSON with $schema field
    console.log('\n=== Step 4: Verify valid JSON with $schema ===');
    // The CLI prints some whitespace/formatting, parse the JSON portion
    let schema;
    try {
      schema = JSON.parse(schemaOutput.trim());
    } catch (e) {
      throw new Error(`Output is not valid JSON: ${e.message}`);
    }
    if (!schema.$schema || !schema.$schema.includes('json-schema.org')) {
      throw new Error('Expected $schema URI');
    }
    if (schema.title !== 'API Schemas') {
      throw new Error('Expected title "API Schemas"');
    }
    console.log('  Valid JSON with $schema URI and title ✓');

    // Step 5: Verify $defs contains request schemas for POST/PUT
    console.log('\n=== Step 5: Verify request schemas for POST/PUT ===');
    const defs = schema.$defs;
    if (!defs) throw new Error('Expected $defs');

    if (!defs.PostApiUsersRequest) {
      throw new Error('Expected PostApiUsersRequest in $defs');
    }
    if (!defs.PutApiUsersIdRequest) {
      throw new Error('Expected PutApiUsersIdRequest in $defs');
    }
    // GET and DELETE should NOT have request schemas
    if (defs.GetApiUsersRequest) {
      throw new Error('GET routes should not have request schemas');
    }
    if (defs.DeleteApiUsersIdRequest) {
      throw new Error('DELETE routes should not have request schemas');
    }
    console.log('  POST and PUT request schemas present, GET/DELETE excluded ✓');

    // Step 6: Verify response schemas for all routes
    console.log('\n=== Step 6: Verify response schemas ===');
    if (!defs.GetApiUsersResponse) {
      throw new Error('Expected GetApiUsersResponse');
    }
    if (!defs.PostApiUsersResponse) {
      throw new Error('Expected PostApiUsersResponse');
    }
    if (!defs.PutApiUsersIdResponse) {
      throw new Error('Expected PutApiUsersIdResponse');
    }
    if (!defs.DeleteApiUsersIdResponse) {
      throw new Error('Expected DeleteApiUsersIdResponse');
    }
    console.log('  Response schemas for all 4 routes ✓');

    // Step 7: Verify property types
    console.log('\n=== Step 7: Verify property types ===');
    const postReq = defs.PostApiUsersRequest;
    if (postReq.type !== 'object') {
      throw new Error('POST request should be object type');
    }
    if (postReq.properties.name.type !== 'string') {
      throw new Error('name should be string type');
    }
    if (postReq.properties.email.type !== 'string') {
      throw new Error('email should be string type');
    }
    if (postReq.properties.age.type !== 'number') {
      throw new Error('age should be number type');
    }
    console.log('  String, number types correctly mapped ✓');

    // Step 8: Verify array type handling
    console.log('\n=== Step 8: Verify array type handling ===');
    const getResp = defs.GetApiUsersResponse;
    if (getResp.properties.users.type !== 'array') {
      throw new Error('users should be array type');
    }
    if (!getResp.properties.users.items) {
      throw new Error('array should have items schema');
    }
    if (getResp.properties.users.items.type !== 'object') {
      throw new Error('array items should be object type');
    }
    if (getResp.properties.users.items.properties.id.type !== 'number') {
      throw new Error('user id should be number type');
    }
    if (getResp.properties.users.items.properties.active.type !== 'boolean') {
      throw new Error('user active should be boolean type');
    }
    console.log('  Array with nested object items ✓');

    // Step 9: Verify required fields
    console.log('\n=== Step 9: Verify required fields ===');
    if (!Array.isArray(postReq.required)) {
      throw new Error('Expected required array');
    }
    if (!postReq.required.includes('name')) {
      throw new Error('name should be required');
    }
    if (!postReq.required.includes('email')) {
      throw new Error('email should be required');
    }
    if (!postReq.required.includes('age')) {
      throw new Error('age should be required');
    }
    console.log('  Required fields correctly listed ✓');

    // Step 10: Verify backend API directly
    console.log('\n=== Step 10: Verify backend API (format=json-schema) ===');
    const apiRes = await fetch('http://localhost:4888/api/codegen?format=json-schema');
    const apiData = await apiRes.json();
    if (!apiData.types) {
      throw new Error('Backend should return types field');
    }
    const apiSchema = JSON.parse(apiData.types);
    if (!apiSchema.$schema || !apiSchema.$defs) {
      throw new Error('Backend should return valid JSON Schema');
    }
    console.log('  Backend API returns JSON Schema correctly ✓');

    // Step 11: Validate schema structure (simulate ajv-like validation)
    console.log('\n=== Step 11: Validate schema structure ===');
    // Valid data against PostApiUsersRequest
    const postSchema = defs.PostApiUsersRequest;
    const validData = { name: 'Alice', email: 'alice@test.com', age: 30 };
    // Check all required fields present
    for (const field of postSchema.required) {
      if (!(field in validData)) {
        throw new Error(`Validation: missing required field ${field}`);
      }
    }
    // Check types match
    for (const [key, val] of Object.entries(validData)) {
      const expectedType = postSchema.properties[key]?.type;
      if (expectedType && typeof val !== expectedType) {
        throw new Error(`Validation: ${key} should be ${expectedType}, got ${typeof val}`);
      }
    }
    console.log('  Valid data passes schema validation ✓');

    // Invalid data — wrong type
    const invalidData = { name: 123, email: 'test@test.com', age: 'thirty' };
    let typeErrors = 0;
    for (const [key, val] of Object.entries(invalidData)) {
      const expectedType = postSchema.properties[key]?.type;
      if (expectedType && typeof val !== expectedType) {
        typeErrors++;
      }
    }
    if (typeErrors !== 2) {
      throw new Error(`Expected 2 type errors, got ${typeErrors}`);
    }
    console.log('  Invalid data correctly detected (2 type errors) ✓');

    // Write to file
    const outFile = path.join(__dirname, '.test-json-schema-output.json');
    execSync(
      `npx trickle codegen --json-schema --out ${outFile}`,
      { encoding: 'utf-8', env: { ...process.env, TRICKLE_BACKEND_URL: 'http://localhost:4888' } },
    );
    const fileSchema = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    if (!fileSchema.$defs || Object.keys(fileSchema.$defs).length < 4) {
      throw new Error('File should contain at least 4 schema definitions');
    }
    console.log(`  Written to file with ${Object.keys(fileSchema.$defs).length} definitions ✓`);
    try { fs.unlinkSync(outFile); } catch {}

    // Step 12: Clean shutdown
    console.log('\n=== Step 12: Clean shutdown ===');

    console.log('\n=== ALL TESTS PASSED ===');
    console.log('trickle codegen --json-schema generates JSON Schema definitions!\n');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    if (backendProc) { backendProc.kill('SIGTERM'); await sleep(300); }
    process.exit(process.exitCode || 0);
  }
}

run();
