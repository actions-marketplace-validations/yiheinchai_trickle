/**
 * Unit tests for the Next.js plugin and loader (withTrickle, next-loader).
 *
 * Tests the transformation logic directly using transformEsmSource,
 * mirroring what the webpack loader applies to Next.js component files.
 *
 * Run with: node --experimental-strip-types --test src/next-plugin.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformEsmSource } from '../dist/vite-plugin.js';

const BACKEND = 'http://localhost:4888';

function transformNextTsx(code: string, filename = '/app/components/MyComponent.tsx'): string {
  return transformEsmSource(code, filename, 'MyComponent', BACKEND, false, false);
}

function transformNextTs(code: string, filename = '/app/utils/helper.ts'): string {
  return transformEsmSource(code, filename, 'helper', BACKEND, false, false);
}

// ── Next.js component patterns ─────────────────────────────────────────────

describe('Next.js Client Component tracking', () => {
  it('tracks a "use client" component with useState', () => {
    const code = [
      `'use client';`,
      `import { useState } from 'react';`,
      `export default function Counter() {`,
      `  const [count, setCount] = useState(0);`,
      `  return <div>{count}</div>;`,
      `}`,
    ].join('\n');
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track render count');
    assert.ok(out.includes('__trickle_ss'), 'should track useState');
  });

  it('tracks a "use client" arrow component with hooks', () => {
    const code = [
      `'use client';`,
      `import { useState, useEffect } from 'react';`,
      `const ProductCart: React.FC<Props> = ({ items }) => {`,
      `  const [open, setOpen] = useState(false);`,
      `  useEffect(() => { syncCart(); }, [items]);`,
      `  return <div />;`,
      `};`,
    ].join('\n');
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track render');
    assert.ok(out.includes('__trickle_ss'), 'should track useState');
    assert.ok(out.includes('__trickle_hw'), 'should track useEffect');
  });
});

describe('Next.js Server Component tracking', () => {
  it('tracks a Server Component (no use client directive)', () => {
    const code = [
      `import { db } from '@/lib/db';`,
      `export default async function ProductPage({ params }: { params: { id: string } }) {`,
      `  const product = await db.product.findUnique({ where: { id: params.id } });`,
      `  return <div>{product?.name}</div>;`,
      `}`,
    ].join('\n');
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track Server Component renders');
  });

  it('tracks a named Server Component export', () => {
    const code = [
      `export function Navbar({ user }: { user: User }) {`,
      `  return <nav>{user.name}</nav>;`,
      `}`,
    ].join('\n');
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track named export server component');
  });
});

describe('Next.js App Router component patterns', () => {
  it('tracks export default function (most common Next.js page pattern)', () => {
    const code = `export default function Page() { return <main />; }`;
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track default page export');
  });

  it('tracks React.memo wrapped component in Next.js', () => {
    const code = [
      `const ProductCard = React.memo(({ product }: { product: Product }) => {`,
      `  return <div>{product.name}</div>;`,
      `});`,
    ].join('\n');
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track memo-wrapped Next.js component');
  });

  it('tracks React.FC typed component in Next.js', () => {
    const code = [
      `const SiteHeader: React.FC<{ title: string }> = ({ title }) => {`,
      `  return <header>{title}</header>;`,
      `};`,
    ].join('\n');
    const out = transformNextTsx(code);
    assert.ok(out.includes('__trickle_rc'), 'should track React.FC component');
  });
});

describe('Next.js: withTrickle plugin registration', () => {
  it('withTrickle returns an object with a webpack function', async () => {
    const { withTrickle } = await import('../dist/next-plugin.js');
    const result = withTrickle({ reactStrictMode: true });
    assert.ok(result, 'withTrickle should return a config object');
    assert.equal(typeof result.webpack, 'function', 'should add webpack function');
    assert.equal(result.reactStrictMode, true, 'should preserve existing config');
  });

  it('withTrickle webpack function returns config with trickle loader rule', async () => {
    const { withTrickle } = await import('../dist/next-plugin.js');
    const result = withTrickle({});
    const mockConfig = { module: { rules: [] } };
    const updatedConfig = result.webpack(mockConfig, { isServer: false });
    assert.ok(updatedConfig.module.rules.length > 0, 'should add at least one rule');
    const rule = updatedConfig.module.rules[0] as { test: RegExp; use: { loader: string }[] };
    assert.ok(rule.test instanceof RegExp, 'rule should have a test regex');
    assert.ok(rule.test.test('Component.tsx'), 'rule should match .tsx files');
    assert.ok(rule.test.test('Component.jsx'), 'rule should match .jsx files');
    assert.ok(!rule.test.test('helper.py'), 'rule should not match .py files');
  });

  it('withTrickle preserves existing webpack config', async () => {
    const { withTrickle } = await import('../dist/next-plugin.js');
    let calledWith = false;
    const originalWebpack = (_config: unknown, _ctx: unknown) => { calledWith = true; return { module: { rules: [] } }; };
    const result = withTrickle({ webpack: originalWebpack });
    result.webpack({ module: { rules: [] } }, { isServer: false });
    assert.ok(calledWith, 'should call original webpack function');
  });

  it('withTrickle works with no arguments', async () => {
    const { withTrickle } = await import('../dist/next-plugin.js');
    assert.doesNotThrow(() => withTrickle(), 'withTrickle() with no args should not throw');
  });
});

describe('Next.js: does not instrument non-React files', () => {
  it('does not inject render tracker in .ts utility files', () => {
    const code = `export function formatPrice(amount: number): string { return '$' + amount; }`;
    const out = transformNextTs(code);
    assert.ok(!out.includes('__trickle_rc'), 'should not inject render tracker in .ts files');
  });

  it('does not inject useState tracker in .ts files', () => {
    const code = `function helper() { const [x, setX] = useState(0); return x; }`;
    const out = transformNextTs(code);
    assert.ok(!out.includes('__trickle_ss'), 'should not track useState in .ts files');
  });
});
