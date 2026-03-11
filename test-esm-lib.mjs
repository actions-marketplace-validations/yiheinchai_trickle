/**
 * ESM library — functions exported using ESM syntax.
 * NO trickle imports. Instrumented externally via --import trickle/auto-esm.
 */

export function tokenize(text, options) {
  const sep = (options && options.separator) || /\s+/;
  const lower = (options && options.lowercase) !== false;
  const tokens = text.split(sep).filter(t => t.length > 0);
  return {
    tokens: lower ? tokens.map(t => t.toLowerCase()) : tokens,
    count: tokens.length,
    unique: [...new Set(lower ? tokens.map(t => t.toLowerCase()) : tokens)].length,
  };
}

export function buildIndex(documents) {
  const index = {};
  for (const doc of documents) {
    const words = doc.text.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (!index[word]) index[word] = [];
      if (!index[word].includes(doc.id)) {
        index[word].push(doc.id);
      }
    }
  }
  return {
    terms: Object.keys(index).length,
    documents: documents.length,
    index,
  };
}

export async function fetchAndParse(url, transform) {
  // Simulated async function
  const data = { url, status: 200, body: 'simulated' };
  const result = transform ? transform(data) : data;
  return {
    success: true,
    data: result,
    timing: { start: Date.now(), end: Date.now() },
  };
}
