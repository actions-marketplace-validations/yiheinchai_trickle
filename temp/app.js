const express = require("express");
const app = express();

app.get("/api/users", (req, res) => {
  res.json({
    users: [{ id: 1, name: "Alice", email: "alice@test.com" }],
    total: 1,
    page: 1,
  });
});

app.get("/api/orders", (req, res) => {
  res.json({
    orders: [{ orderId: 42, status: "shipped", amount: 99.99 }],
    total: 1,
  });
});

app.post("/api/users", express.json(), (req, res) => {
  res.json({ id: 2, name: req.body.name, created: true });
});

app.listen(3456, () => console.log("Demo API on http://localhost:3456"));
