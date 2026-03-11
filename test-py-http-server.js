/**
 * Simple HTTP server that returns JSON responses.
 * Used by test-py-http-app.py and test-py-http-e2e.js.
 */
const http = require('http');

const PORT = 4569;

const users = [
  { id: 1, name: 'Alice Smith', email: 'alice@example.com', role: 'admin' },
  { id: 2, name: 'Bob Jones', email: 'bob@example.com', role: 'user' },
  { id: 3, name: 'Carol White', email: 'carol@example.com', role: 'user' },
];

const config = {
  appName: 'TestApp',
  version: '2.1.0',
  features: { darkMode: true, notifications: false },
  maxRetries: 3,
};

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/users' && req.method === 'GET') {
    res.end(JSON.stringify(users));
  } else if (req.url === '/api/config' && req.method === 'GET') {
    res.end(JSON.stringify(config));
  } else if (req.url === '/api/users' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const newUser = JSON.parse(body);
      const created = { id: users.length + 1, ...newUser };
      res.statusCode = 201;
      res.end(JSON.stringify(created));
    });
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Test server listening on http://localhost:${PORT}`);
});

module.exports = { server, PORT };
