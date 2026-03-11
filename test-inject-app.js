// Test app for JSDoc injection
require('./packages/client-js/auto');

const { calculateTax, formatUser, filterItems } = require('./test-inject-lib');

const tax = calculateTax(100, 8.5);
console.log('Tax:', tax.tax);

const user = formatUser(
  { firstName: 'Alice', lastName: 'Smith', email: 'ALICE@EXAMPLE.COM' },
  'en-GB'
);
console.log('User:', user.display);

const filtered = filterItems([1, 2, 3, 4, 5], 3);
console.log('Filtered:', filtered.count);

console.log('Done!');
