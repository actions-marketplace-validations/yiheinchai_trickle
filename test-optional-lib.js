/**
 * Library with functions that accept optional parameters.
 * Used for testing optional param type generation.
 */

function greet(name, greeting) {
  if (greeting) {
    return `${greeting}, ${name}!`;
  }
  return `Hello, ${name}!`;
}

function search(query, limit, offset) {
  const results = ['result1', 'result2', 'result3'];
  const start = offset || 0;
  const end = (limit || 10) + start;
  return { results: results.slice(start, end), query, total: results.length };
}

class Config {
  get(key, defaultValue) {
    const store = { theme: 'dark', lang: 'en' };
    return store[key] || defaultValue || null;
  }
}

module.exports = { greet, search, Config };
