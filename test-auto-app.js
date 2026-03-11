/**
 * App that uses `require('trickle/auto')` — one line, no config.
 * Used by test-auto-require-e2e.js.
 */

// This ONE LINE is all you need:
require('./packages/client-js/auto');

// --- Your normal app code below ---
const { calculateDiscount, formatInvoice, validateAddress } = require('./test-auto-lib');

// Exercise the functions
const disc = calculateDiscount(99.99, 15);
console.log("Discount:", disc.saved);

const invoice = formatInvoice(
  [
    { name: "Widget", price: 25, qty: 4 },
    { name: "Gadget", price: 50, qty: 1 },
  ],
  { name: "Alice Smith" }
);
console.log("Invoice total:", invoice.total);

const addr = validateAddress({
  street: "123 Main St",
  city: "Springfield",
  state: "il",
  zip: "62701",
});
console.log("Address valid:", addr.valid);

console.log("Done!");
