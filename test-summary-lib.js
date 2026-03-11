/**
 * Library for testing type summary output.
 */

function greet(name, greeting) {
  return { message: `${greeting}, ${name}!`, name, greeting };
}

function add(a, b) {
  return { result: a + b, a, b };
}

function toUpper(text) {
  return { original: text, upper: text.toUpperCase() };
}

module.exports = { greet, add, toUpper };
