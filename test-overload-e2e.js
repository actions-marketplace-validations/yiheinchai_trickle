/**
 * E2E test: Function overload generation from multiple type observations
 *
 * Verifies that when a function is called with different argument types,
 * trickle generates TypeScript overloads and Python @overload decorators
 * instead of flattening everything into union types.
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
    'test-overload-lib.d.ts',
    'test_overload_lib.pyi',
  ]) {
    try { fs.unlinkSync(f); } catch {}
  }
}

async function run() {
  try {
    cleanup();

    // ── Step 1: JS overload generation ──
    console.log('\n=== Step 1: JS function overloads ===');

    const jsResult = execSync('node test-overload-app.js', {
      encoding: 'utf8',
      env: { ...process.env, TRICKLE_LOCAL: '1' },
    });

    console.log(jsResult.trim());
    assert(jsResult.includes('format string: HELLO'), 'JS format(string) works');
    assert(jsResult.includes('format number: 42.00'), 'JS format(number) works');
    assert(jsResult.includes('format boolean: yes'), 'JS format(boolean) works');
    assert(jsResult.includes('Done!'), 'JS app completed');

    // Check .d.ts was generated
    const dtsPath = 'test-overload-lib.d.ts';
    assert(fs.existsSync(dtsPath), '.d.ts file generated');

    const dts = fs.readFileSync(dtsPath, 'utf8');
    console.log('\n  Generated .d.ts:');
    console.log(dts.split('\n').map(l => '    ' + l).join('\n'));

    // format() should have 3 overloads (string, number, boolean)
    const formatOverloads = dts.split('\n').filter(l =>
      l.includes('export declare function format(')
    );
    assert(
      formatOverloads.length === 3,
      `format() has 3 overloads (got ${formatOverloads.length})`
    );

    // Each overload should have a specific param type (not a union)
    assert(
      formatOverloads.some(l => l.includes('value: string')),
      'format() has string overload'
    );
    assert(
      formatOverloads.some(l => l.includes('value: number')),
      'format() has number overload'
    );
    assert(
      formatOverloads.some(l => l.includes('value: boolean')),
      'format() has boolean overload'
    );

    // convert() should have 2 overloads
    const convertOverloads = dts.split('\n').filter(l =>
      l.includes('export declare function convert(')
    );
    assert(
      convertOverloads.length === 2,
      `convert() has 2 overloads (got ${convertOverloads.length})`
    );

    // Parser.parse() should have 2 overloads in the class
    assert(
      dts.includes('export declare class Parser'),
      '.d.ts has Parser class'
    );
    const parseOverloads = dts.split('\n').filter(l =>
      l.trim().startsWith('parse(')
    );
    assert(
      parseOverloads.length === 2,
      `Parser.parse() has 2 overloads (got ${parseOverloads.length})`
    );

    // ── Step 2: Python overload generation ──
    console.log('\n=== Step 2: Python @overload decorators ===');

    // Clean JSONL so Python observations don't mix with JS
    cleanup();

    const pyResult = execSync('python test_overload_app.py', {
      encoding: 'utf8',
      env: { ...process.env },
    });

    console.log(pyResult.trim());
    assert(pyResult.includes('format string: HELLO'), 'Python format_value(string) works');
    assert(pyResult.includes('format int: 42.00'), 'Python format_value(int) works');
    assert(pyResult.includes('Done!'), 'Python app completed');

    // Check .pyi was generated
    const pyiPath = 'test_overload_lib.pyi';
    assert(fs.existsSync(pyiPath), '.pyi file generated');

    const pyi = fs.readFileSync(pyiPath, 'utf8');
    console.log('\n  Generated .pyi:');
    console.log(pyi.split('\n').map(l => '    ' + l).join('\n'));

    // format_value should have @overload decorators
    const overloadCount = (pyi.match(/@overload/g) || []).length;
    assert(
      overloadCount >= 2,
      `@overload appears ${overloadCount} times (expected >= 2)`
    );

    // format_value should have overloaded signatures
    const formatValueLines = pyi.split('\n').filter(l =>
      l.includes('def format_value(')
    );
    assert(
      formatValueLines.length >= 3,
      `format_value has ${formatValueLines.length} signatures (overloads + impl)`
    );

    // Check that overloads have specific types, not unions
    assert(
      formatValueLines.some(l => l.includes('value: str')),
      'format_value has str overload'
    );
    assert(
      formatValueLines.some(l => l.includes('value: int')),
      'format_value has int overload'
    );

    // convert should have overloads too
    const convertLines = pyi.split('\n').filter(l =>
      l.includes('def convert(')
    );
    assert(
      convertLines.length >= 3,
      `convert has ${convertLines.length} signatures (overloads + impl)`
    );

    // Parser.parse should have @overload in class
    assert(
      pyi.includes('class Parser:'),
      '.pyi has Parser class'
    );
    const parseLines = pyi.split('\n').filter(l =>
      l.includes('def parse(')
    );
    assert(
      parseLines.length >= 3,
      `Parser.parse has ${parseLines.length} signatures (overloads + impl)`
    );

    // Check that implementation signature uses Union types
    assert(
      pyi.includes('Union['),
      '.pyi has Union types in implementation signature'
    );

    // Check that @overload import exists
    assert(
      pyi.includes('overload'),
      '.pyi imports overload from typing'
    );

    // ── Step 3: Verify JSONL has multiple typeHashes per function ──
    console.log('\n=== Step 3: Verify observation format ===');

    const jsonl = fs.readFileSync('.trickle/observations.jsonl', 'utf8');
    const obs = jsonl.trim().split('\n').map(l => JSON.parse(l));

    // Group by functionName and count unique hashes
    const byFunc = {};
    for (const o of obs) {
      byFunc[o.functionName] = byFunc[o.functionName] || new Set();
      byFunc[o.functionName].add(o.typeHash);
    }

    assert(
      (byFunc['format_value'] || new Set()).size >= 2,
      `format_value has ${(byFunc['format_value'] || new Set()).size} distinct type hashes`
    );
    assert(
      (byFunc['convert'] || new Set()).size >= 2,
      `convert has ${(byFunc['convert'] || new Set()).size} distinct type hashes`
    );
    assert(
      (byFunc['Parser.parse'] || new Set()).size >= 2,
      `Parser.parse has ${(byFunc['Parser.parse'] || new Set()).size} distinct type hashes`
    );

    cleanup();

    // ── Summary ──
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log('\nAll overload generation tests passed!');
    }

  } catch (err) {
    console.error('\nTEST ERROR:', err.message);
    if (err.stdout) console.log('stdout:', err.stdout);
    if (err.stderr) console.log('stderr:', err.stderr);
    process.exitCode = 1;
  }
}

run();
