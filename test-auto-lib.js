/**
 * Library functions used by test-auto-app.js.
 * These are in a separate file so trickle/auto can instrument them
 * (the Module._compile hook applies to files loaded AFTER the hook is installed).
 */

function calculateDiscount(price, percentage) {
  const discount = price * (percentage / 100);
  return {
    original: price,
    discount,
    final: price - discount,
    saved: `$${discount.toFixed(2)}`,
  };
}

function formatInvoice(items, customer) {
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  return {
    customer: customer.name,
    lineItems: items.length,
    subtotal: total,
    tax: total * 0.08,
    total: total * 1.08,
    currency: "USD",
  };
}

function validateAddress(addr) {
  return {
    valid: Boolean(addr.street && addr.city && addr.zip),
    normalized: {
      street: (addr.street || "").trim(),
      city: (addr.city || "").trim(),
      state: (addr.state || "").toUpperCase(),
      zip: String(addr.zip || "").replace(/\s/g, ""),
    },
  };
}

module.exports = { calculateDiscount, formatInvoice, validateAddress };
