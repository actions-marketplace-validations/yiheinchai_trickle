/**
 * App that calls functions with different numbers of arguments
 * to trigger optional parameter detection.
 */
require('trickle/auto');

const { greet, search, Config } = require('./test-optional-lib');

// greet with 1 arg (no greeting)
console.log('greet 1:', greet('Alice'));

// greet with 2 args (with greeting)
console.log('greet 2:', greet('Bob', 'Hi'));

// search with 1 arg
console.log('search 1:', search('test').total);

// search with 2 args
console.log('search 2:', search('test', 5).total);

// search with 3 args
console.log('search 3:', search('test', 5, 1).total);

// Config.get with 1 arg
const config = new Config();
console.log('config 1:', config.get('theme'));

// Config.get with 2 args
console.log('config 2:', config.get('missing', 'fallback'));

console.log('Done!');
