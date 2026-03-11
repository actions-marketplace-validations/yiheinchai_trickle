/**
 * Simulated server used by test-live-types-e2e.js.
 *
 * Calls different functions at intervals to simulate a server
 * handling requests. Functions are called over time to test that
 * types are generated live (while the process runs), not just at exit.
 */

const http = require("http");

// --- Functions that will be observed ---

function handleGetUser(id) {
  return {
    id,
    name: "Alice",
    email: "alice@example.com",
    createdAt: "2024-01-15",
  };
}

function handleCreateOrder(order) {
  return {
    orderId: Math.floor(Math.random() * 10000),
    status: "pending",
    total: order.items.reduce((s, i) => s + i.price * i.qty, 0),
    itemCount: order.items.length,
  };
}

function handleSearch(query) {
  return {
    results: [
      { title: "Widget", score: 0.95 },
      { title: "Gadget", score: 0.87 },
    ],
    totalHits: 2,
    queryTime: 42,
  };
}

// --- Simple HTTP server that exercises the functions ---

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let result;
    const url = req.url;

    if (url === "/api/user") {
      result = handleGetUser(1);
    } else if (url === "/api/order") {
      const order = body ? JSON.parse(body) : { items: [{ name: "Widget", price: 9.99, qty: 1 }] };
      result = handleCreateOrder(order);
    } else if (url === "/api/search") {
      result = handleSearch("widgets");
    } else {
      result = { status: "ok" };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  });
});

// Start server on a random available port
server.listen(0, () => {
  const port = server.address().port;
  console.log(`SERVER_PORT=${port}`);
  console.log("Server running");

  // Simulate requests at intervals
  let requestCount = 0;

  const makeRequest = async (path) => {
    try {
      const resp = await fetch(`http://localhost:${port}${path}`);
      const data = await resp.json();
      requestCount++;
      console.log(`REQUEST_${requestCount}=${path}`);
    } catch {
      // ignore
    }
  };

  // Schedule requests at different times (spaced out so live watcher can detect each)
  setTimeout(() => makeRequest("/api/user"), 500);
  setTimeout(() => makeRequest("/api/order"), 2000);
  setTimeout(() => makeRequest("/api/search"), 4000);

  // After all requests, wait for watcher to catch up then exit
  setTimeout(() => {
    console.log(`TOTAL_REQUESTS=${requestCount}`);
    console.log("Server shutting down");
    server.close();
    process.exit(0);
  }, 8000);
});
