/**
 * A plain Express app with ZERO trickle code.
 * Used by test-register-e2e.js to verify auto-instrumentation via -r trickle/register.
 */
const express = require('express');

const app = express();
app.use(express.json());

app.get('/api/products', (req, res) => {
  res.json({
    products: [
      { id: 1, name: 'Widget', price: 29.99, inStock: true },
      { id: 2, name: 'Gadget', price: 49.99, inStock: false },
    ],
    count: 2,
  });
});

app.get('/api/products/:id', (req, res) => {
  res.json({
    id: parseInt(req.params.id),
    name: 'Widget',
    price: 29.99,
    inStock: true,
    tags: ['electronics', 'sale'],
  });
});

app.post('/api/cart', (req, res) => {
  const { productId, quantity } = req.body;
  res.json({
    cartId: `CART-${Date.now()}`,
    productId,
    quantity,
    added: true,
  });
});

const server = app.listen(3458, async () => {
  console.log('READY');

  // Notify parent process we're ready (for the E2E test to start making requests)
  if (process.send) {
    process.send('ready');
  }
});

// Keep alive until killed
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
