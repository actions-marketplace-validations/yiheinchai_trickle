/**
 * App that uses class-based code for testing class method observation.
 */
require('trickle/auto');

const { Calculator, Formatter } = require('./test-class-lib');

const calc = new Calculator();
console.log('add:', calc.add(10, 5).result);
console.log('multiply:', calc.multiply(3, 4).result);
console.log('square:', calc.square(7).result);

const fmt = new Formatter();
console.log('name:', fmt.formatName('John', 'Doe').display);
console.log('currency:', fmt.formatCurrency(99.99, '$').formatted);

console.log('Done!');
