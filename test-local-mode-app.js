/**
 * App used by test-local-mode-e2e.js.
 * Tests that trickle works in offline/local mode without a backend.
 */

function parseConfig(raw) {
  return {
    host: raw.host || "localhost",
    port: raw.port || 3000,
    debug: Boolean(raw.debug),
    features: raw.features || [],
  };
}

function buildResponse(status, data) {
  return {
    status,
    body: data,
    timestamp: Date.now(),
    headers: { "content-type": "application/json" },
  };
}

function validateEmail(email) {
  const valid = typeof email === "string" && email.includes("@");
  return { valid, normalized: email.trim().toLowerCase() };
}

// Exercise the functions
const config = parseConfig({ host: "api.example.com", port: 8080, debug: true, features: ["auth", "logs"] });
console.log("Config:", config.host, config.port);

const resp = buildResponse(200, { message: "ok", count: 42 });
console.log("Response:", resp.status);

const check = validateEmail("  User@Example.COM  ");
console.log("Email valid:", check.valid);

console.log("Done!");
