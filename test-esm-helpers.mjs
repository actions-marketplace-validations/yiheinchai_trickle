/**
 * ESM helper module — functions exported using ES module syntax.
 * trickle run should capture types from these via ESM loader hooks.
 */

export function parseConfig(raw) {
  return {
    host: raw.host || 'localhost',
    port: raw.port || 3000,
    debug: raw.debug || false,
  };
}

export function processItems(items) {
  return items.map(item => ({
    id: item.id,
    name: item.name.toUpperCase(),
    processed: true,
  }));
}

export const calculateTotal = (prices, taxRate) => {
  const subtotal = prices.reduce((sum, p) => sum + p, 0);
  return { subtotal, tax: subtotal * taxRate, total: subtotal * (1 + taxRate) };
};
