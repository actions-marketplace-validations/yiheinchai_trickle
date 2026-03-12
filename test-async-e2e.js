/**
 * E2E test: Async function type generation
 *
 * Verifies that async functions generate correct Promise<T> / Awaitable[T]
 * return types in .d.ts and .pyi files, while sync functions remain unwrapped.
 */
const { execSync } = require('child_process');
const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function cleanup() {
  for (const f of [
    '.trickle/observations.jsonl',
    '.trickle/type-snapshot.json',
    'test-async-lib.d.ts',
    'test_async_lib.pyi',
  ]) {
    try { fs.unlinkSync(f); } catch {}
  }
}

async function run() {
  try {
    cleanup();

    // ── Step 1: JS async type generation ──
    console.log('\n=== Step 1: JS async functions ===');

    const jsResult = execSync('node test-async-app.js', {
      encoding: 'utf8',
      env: { ...process.env, TRICKLE_LOCAL: '1' },
    });
    console.log(jsResult.trim());
    assert(jsResult.includes('Done!'), 'JS app completed');

    const dts = fs.readFileSync('test-async-lib.d.ts', 'utf8');

    // Async standalone functions should return Promise<T>
    assert(
      dts.includes('fetchUser(id: string): Promise<FetchUserOutput>'),
      '.d.ts: fetchUser returns Promise<FetchUserOutput>'
    );
    assert(
      dts.includes('searchProducts(query: string, limit: number): Promise<SearchProductsOutput>'),
      '.d.ts: searchProducts returns Promise<SearchProductsOutput>'
    );

    // Sync function should NOT have Promise wrapper
    assert(
      dts.includes('formatPrice(amount: number, currency: string): FormatPriceOutput;'),
      '.d.ts: formatPrice returns FormatPriceOutput (no Promise)'
    );
    assert(
      !dts.includes('formatPrice') || !dts.match(/formatPrice.*Promise/),
      '.d.ts: formatPrice does NOT use Promise'
    );

    // Async class methods should return Promise<T>
    assert(
      dts.includes('getProfile(userId: string): Promise<'),
      '.d.ts: ApiClient.getProfile returns Promise<...>'
    );
    assert(
      dts.includes('postComment(postId: string, text: string): Promise<'),
      '.d.ts: ApiClient.postComment returns Promise<...>'
    );

    // Sync class method should NOT have Promise
    assert(
      dts.includes('getVersion():') && !dts.match(/getVersion\(\): Promise/),
      '.d.ts: ApiClient.getVersion does NOT return Promise'
    );

    // Check JSONL has isAsync field
    cleanup();

    // ── Step 2: Python async type generation ──
    console.log('\n=== Step 2: Python async functions ===');

    const pyResult = execSync('python test_async_app.py', {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: 'packages/client-python/src:.' },
    });
    console.log(pyResult.trim());
    assert(pyResult.includes('Done!'), 'Python app completed');

    const pyi = fs.readFileSync('test_async_lib.pyi', 'utf8');

    // Async standalone functions should use async def + Awaitable[T]
    assert(
      pyi.includes('async def fetch_user'),
      '.pyi: fetch_user is async def'
    );
    assert(
      pyi.includes('Awaitable[FetchUserOutput]'),
      '.pyi: fetch_user returns Awaitable[FetchUserOutput]'
    );
    assert(
      pyi.includes('async def search_products'),
      '.pyi: search_products is async def'
    );
    assert(
      pyi.includes('Awaitable[SearchProductsOutput]'),
      '.pyi: search_products returns Awaitable[SearchProductsOutput]'
    );

    // Sync function should use regular def, no Awaitable
    assert(
      pyi.includes('def format_price(amount: float, currency: str) -> FormatPriceOutput'),
      '.pyi: format_price is regular def with direct return type'
    );
    assert(
      !pyi.match(/async def format_price/),
      '.pyi: format_price is NOT async'
    );

    // Async class methods
    assert(
      pyi.includes('async def get_profile'),
      '.pyi: ApiClient.get_profile is async def'
    );
    assert(
      pyi.includes('async def post_comment'),
      '.pyi: ApiClient.post_comment is async def'
    );

    // Sync class method
    const versionLine = pyi.split('\n').find(l => l.includes('def get_version'));
    assert(
      versionLine && !versionLine.includes('async'),
      '.pyi: ApiClient.get_version is NOT async'
    );

    // Check JSONL observations have isAsync field
    const jsonlContent = fs.readFileSync('.trickle/observations.jsonl', 'utf8');
    const observations = jsonlContent.trim().split('\n').map(l => JSON.parse(l));

    const fetchUserObs = observations.find(o => o.functionName === 'fetch_user');
    assert(
      fetchUserObs && fetchUserObs.isAsync === true,
      'JSONL: fetch_user has isAsync=true'
    );

    const formatPriceObs = observations.find(o => o.functionName === 'format_price');
    assert(
      formatPriceObs && !formatPriceObs.isAsync,
      'JSONL: format_price does NOT have isAsync'
    );

    const getProfileObs = observations.find(o => o.functionName === 'ApiClient.get_profile');
    assert(
      getProfileObs && getProfileObs.isAsync === true,
      'JSONL: ApiClient.get_profile has isAsync=true'
    );

    const getVersionObs = observations.find(o => o.functionName === 'ApiClient.get_version');
    assert(
      getVersionObs && !getVersionObs.isAsync,
      'JSONL: ApiClient.get_version does NOT have isAsync'
    );

    cleanup();

    // ── Step 3: JS JSONL verification ──
    console.log('\n=== Step 3: JS JSONL isAsync field ===');

    execSync('node test-async-app.js', {
      encoding: 'utf8',
      env: { ...process.env, TRICKLE_LOCAL: '1' },
    });

    const jsJsonl = fs.readFileSync('.trickle/observations.jsonl', 'utf8');
    const jsObs = jsJsonl.trim().split('\n').map(l => JSON.parse(l));

    const jsFetchUser = jsObs.find(o => o.functionName === 'fetchUser');
    assert(
      jsFetchUser && jsFetchUser.isAsync === true,
      'JS JSONL: fetchUser has isAsync=true'
    );

    const jsFormatPrice = jsObs.find(o => o.functionName === 'formatPrice');
    assert(
      jsFormatPrice && !jsFormatPrice.isAsync,
      'JS JSONL: formatPrice does NOT have isAsync'
    );

    const jsGetProfile = jsObs.find(o => o.functionName === 'ApiClient.getProfile');
    assert(
      jsGetProfile && jsGetProfile.isAsync === true,
      'JS JSONL: ApiClient.getProfile has isAsync=true'
    );

    const jsGetVersion = jsObs.find(o => o.functionName === 'ApiClient.getVersion');
    assert(
      jsGetVersion && !jsGetVersion.isAsync,
      'JS JSONL: ApiClient.getVersion does NOT have isAsync'
    );

    cleanup();

    // ── Summary ──
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log('\nAll async type generation tests passed!');
    }

  } catch (err) {
    console.error('\nTEST ERROR:', err.message);
    if (err.stdout) console.log('stdout:', err.stdout);
    if (err.stderr) console.log('stderr:', err.stderr);
    process.exitCode = 1;
  }
}

run();
