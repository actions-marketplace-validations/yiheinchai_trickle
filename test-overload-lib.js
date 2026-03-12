/**
 * Library with polymorphic functions that accept different argument types.
 * Used for testing overload generation.
 */

function format(value) {
  if (typeof value === 'string') {
    return { formatted: value.toUpperCase(), kind: 'string' };
  }
  if (typeof value === 'number') {
    return { formatted: value.toFixed(2), kind: 'number' };
  }
  if (typeof value === 'boolean') {
    return { formatted: value ? 'yes' : 'no', kind: 'boolean' };
  }
  return { formatted: String(value), kind: 'unknown' };
}

function convert(input, target) {
  if (target === 'string') {
    return String(input);
  }
  if (target === 'number') {
    return Number(input);
  }
  return input;
}

class Parser {
  parse(input) {
    if (typeof input === 'string') {
      return { tokens: input.split(' '), count: input.split(' ').length };
    }
    if (Array.isArray(input)) {
      return { tokens: input, count: input.length };
    }
    return { tokens: [], count: 0 };
  }
}

module.exports = { format, convert, Parser };
