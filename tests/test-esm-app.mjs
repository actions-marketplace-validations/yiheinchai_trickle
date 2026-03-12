/**
 * ESM app — uses import/export syntax. NO trickle imports.
 * Run with: node --import trickle/auto-esm test-esm-app.mjs
 */

import { tokenize, buildIndex, fetchAndParse } from './test-esm-lib.mjs';

// Exercise the functions
const tokens = tokenize("Hello World this is a test of ESM modules", { lowercase: true });
console.log(`Tokens: ${tokens.count} (${tokens.unique} unique)`);

const idx = buildIndex([
  { id: 'doc1', text: 'hello world' },
  { id: 'doc2', text: 'world of code' },
  { id: 'doc3', text: 'hello code world' },
]);
console.log(`Index: ${idx.terms} terms across ${idx.documents} docs`);

const result = await fetchAndParse('https://example.com', d => ({ ...d, parsed: true }));
console.log(`Fetch: success=${result.success}`);

console.log("Done!");
