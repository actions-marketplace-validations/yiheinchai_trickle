/**
 * App for testing type summary output. Calls all functions in test-summary-lib.
 */
require('trickle/auto');

const { greet, add, toUpper } = require('./test-summary-lib');

greet('World', 'Hello');
add(10, 20);
toUpper('hello');

console.log('Done!');
