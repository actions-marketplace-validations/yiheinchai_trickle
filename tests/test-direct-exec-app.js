/**
 * App used by test-direct-exec-e2e.js.
 * Tests that `trickle app.js` works (direct file execution shorthand).
 */

function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return { total, itemCount: items.length, currency: "USD" };
}

function formatReceipt(order) {
  return {
    lines: order.items.map(i => `${i.name} x${i.quantity}: $${i.price * i.quantity}`),
    total: `$${order.total}`,
    date: new Date().toISOString().split("T")[0],
  };
}

const items = [
  { name: "Widget", price: 9.99, quantity: 3 },
  { name: "Gadget", price: 24.99, quantity: 1 },
];

const total = calculateTotal(items);
console.log("Total:", total);

const receipt = formatReceipt({ items, total: total.total });
console.log("Receipt:", receipt.lines.length, "lines");

console.log("Done!");
