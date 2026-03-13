/**
 * Unit tests for the Metro transformer (React Native observability).
 *
 * Tests the transformation logic independently — without needing a real Metro
 * bundler or Babel pipeline. We test that transformEsmSource is applied correctly
 * to React Native component source files.
 *
 * Run with: node --experimental-strip-types --test src/metro-transformer.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformEsmSource } from '../dist/vite-plugin.js';

const BACKEND_URL = 'http://localhost:4888';

// Helper: transform as if coming from a .tsx React Native file
function transformRNTsx(code: string, filename = '/app/components/MyComponent.tsx'): string {
  return transformEsmSource(code, filename, 'MyComponent', BACKEND_URL, false, false);
}

// Helper: transform as if coming from a .ts utility file
function transformRNTs(code: string, filename = '/app/utils/helper.ts'): string {
  return transformEsmSource(code, filename, 'helper', BACKEND_URL, false, false);
}

// ── Metro transformer: React component detection ──────────────────────────────

describe('Metro transformer: React component detection', () => {
  it('instruments uppercase components in .tsx files', () => {
    const code = `function OrderCard({ order }) { return null; }`;
    const out = transformRNTsx(code);
    assert.notEqual(out, code, 'should transform');
    assert.ok(out.includes('__trickle_rc'), 'should inject render tracker');
  });

  it('does not inject render tracker for .ts utility files', () => {
    const code = `function formatPrice(amount) { return '$' + amount; }`;
    const out = transformRNTs(code);
    assert.ok(!out.includes('__trickle_rc'), 'should not inject render tracker in .ts files');
  });

  it('instruments export default function components (common React Native screen pattern)', () => {
    const code = `export default function HomeScreen() { return null; }`;
    const out = transformRNTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should inject render tracker for export default function');
  });

  it('does not instrument lowercase utility functions as components', () => {
    const code = `function formatOrder(order) { return order.id; }`;
    const out = transformRNTsx(code);
    if (out !== code) {
      assert.ok(!out.includes('__trickle_rc'), 'lowercase function should not be tracked as component');
    }
  });
});

// ── Metro transformer: useState tracking ─────────────────────────────────────

describe('Metro transformer: useState tracking in React Native', () => {
  it('tracks useState in a React Native functional component', () => {
    const code = [
      `import React, { useState } from 'react';`,
      `function Counter() {`,
      `  const [count, setCount] = useState(0);`,
      `  return null;`,
      `}`,
    ].join('\n');
    const out = transformRNTsx(code);
    assert.ok(out.includes('__trickle_ss'), 'should inject state setter wrapper');
    assert.ok(out.includes('__trickle_s_setCount'), 'should rename original setter');
    assert.ok(out.includes('"count"'), 'should include state variable name');
  });

  it('tracks multiple useState calls in a React Native screen', () => {
    const code = [
      `function CheckoutScreen() {`,
      `  const [items, setItems] = useState([]);`,
      `  const [total, setTotal] = useState(0);`,
      `  const [loading, setLoading] = useState(false);`,
      `  return null;`,
      `}`,
    ].join('\n');
    const out = transformRNTsx(code);
    const count = (out.match(/const \w+=__trickle_ss/g) || []).length;
    assert.equal(count, 3, 'should wrap all 3 useState setters');
  });

  it('handles TypeScript typed useState in React Native', () => {
    const code = [
      `function ProfileScreen() {`,
      `  const [user, setUser] = useState<User | null>(null);`,
      `  return null;`,
      `}`,
    ].join('\n');
    const out = transformRNTsx(code);
    assert.ok(out.includes('__trickle_ss'), 'should track typed useState');
    assert.ok(out.includes('"user"'), 'should include state name');
  });
});

// ── Metro transformer: hook observability ────────────────────────────────────

describe('Metro transformer: hook observability in React Native', () => {
  it('wraps useEffect in a React Native component', () => {
    const code = [
      `function DataScreen() {`,
      `  useEffect(() => {`,
      `    fetchData();`,
      `  }, []);`,
      `  return null;`,
      `}`,
    ].join('\n');
    const out = transformRNTsx(code);
    assert.ok(out.includes('__trickle_hw'), 'should inject hook wrapper for useEffect');
    assert.ok(out.includes('"useEffect"'), 'should record hook name');
  });

  it('wraps useCallback in a React Native component', () => {
    const code = [
      `function ListScreen() {`,
      `  const handlePress = useCallback(() => {`,
      `    navigate('Detail');`,
      `  }, []);`,
      `  return null;`,
      `}`,
    ].join('\n');
    const out = transformRNTsx(code);
    assert.ok(out.includes('__trickle_hw'), 'should inject hook wrapper for useCallback');
    assert.ok(out.includes('"useCallback"'), 'should record hook name');
  });
});

// ── Metro transformer: source unchanged for non-RN files ─────────────────────

describe('Metro transformer: passthrough for non-component files', () => {
  it('does not modify a plain TypeScript utility file', () => {
    const code = `export function add(a: number, b: number): number { return a + b; }`;
    const out = transformRNTs(code);
    // .ts files should not get __trickle_rc (no React components)
    assert.ok(!out.includes('__trickle_rc'), 'should not inject React tracking in .ts files');
  });

  it('does not inject useState tracking in .ts files', () => {
    const code = `function helper() {\n  const [x, setX] = useState(0);\n  return x;\n}`;
    const out = transformRNTs(code);
    assert.ok(!out.includes('__trickle_ss'), 'should not track useState in .ts files');
  });
});
