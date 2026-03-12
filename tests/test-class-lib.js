/**
 * Library with class-based code for testing class method observation.
 */

class Calculator {
  add(a, b) {
    return { result: a + b, operation: 'add' };
  }

  multiply(a, b) {
    return { result: a * b, operation: 'multiply' };
  }

  square(x) {
    return { result: x * x, input: x };
  }
}

class Formatter {
  formatName(first, last) {
    return { display: `${first} ${last}`, first, last };
  }

  formatCurrency(amount, currency) {
    return { formatted: `${currency}${amount.toFixed(2)}`, amount, currency };
  }
}

module.exports = { Calculator, Formatter };
