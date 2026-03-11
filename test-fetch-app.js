/**
 * App that makes fetch calls to an external API.
 * Trickle should auto-capture types from the JSON responses.
 */
const API = 'http://localhost:4567';

async function main() {
  // GET request — fetch list of users
  const usersResp = await fetch(`${API}/api/users`);
  const users = await usersResp.json();
  console.log('users:', users.length, 'items');

  // GET request — fetch config object
  const configResp = await fetch(`${API}/api/config`);
  const config = await configResp.json();
  console.log('config:', config.appName, config.version);

  // POST request — create a new user
  const createResp = await fetch(`${API}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dave Brown', email: 'dave@example.com', role: 'user' }),
  });
  const created = await createResp.json();
  console.log('created:', created.name, 'id:', created.id);

  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
