/**
 * ESM test app — imports from ESM helpers using ES module syntax.
 */
import { parseConfig, processItems, calculateTotal } from './test-esm-helpers.mjs';

const config = parseConfig({ host: 'api.example.com', port: 8080, debug: true });
console.log('config:', config);

const items = processItems([
  { id: 1, name: 'foo' },
  { id: 2, name: 'bar' },
]);
console.log('items:', items.length);

const totals = calculateTotal([10.5, 20.0, 5.25], 0.1);
console.log('totals:', totals);

console.log('Done!');
