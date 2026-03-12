/**
 * App that calls polymorphic functions with different argument types.
 * Each function gets called with different types to trigger overload generation.
 */
require('trickle/auto');

const { format, convert, Parser } = require('./test-overload-lib');

// Call format with string
const r1 = format('hello');
console.log('format string:', r1.formatted);

// Call format with number
const r2 = format(42);
console.log('format number:', r2.formatted);

// Call format with boolean
const r3 = format(true);
console.log('format boolean:', r3.formatted);

// Call convert with string → string
const c1 = convert('hello', 'string');
console.log('convert string->string:', c1);

// Call convert with number → string
const c2 = convert(42, 'string');
console.log('convert number->string:', c2);

// Parser class with different input types
const parser = new Parser();
const p1 = parser.parse('hello world foo');
console.log('parse string:', p1.count);

const p2 = parser.parse(['a', 'b', 'c']);
console.log('parse array:', p2.count);

console.log('Done!');
