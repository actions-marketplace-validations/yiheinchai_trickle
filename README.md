# trickle

Runtime type observability for JavaScript and Python. With minimal setup, trickle records the actual types flowing through your functions at runtime and brings them to compile time — so you get type information in your IDE without writing types yourself.

```bash
# Setup (one command)
trickle init

# Start your app with instrumentation (zero code changes)
node -r trickle/register app.js

# Types appear in your IDE automatically
npm run trickle:dev
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Zero-Code Instrumentation](#zero-code-instrumentation)
- [One-Liner Instrumentation](#one-liner-instrumentation)
- [Manual Instrumentation](#manual-instrumentation)
- [Code Generation](#code-generation)
- [Mock Server](#mock-server)
- [CLI Reference](#cli-reference)
- [Python Support](#python-support)
- [Backend](#backend)
- [How It Works](#how-it-works)
- [Architecture](#architecture)

---

## Quick Start

### 1. Start the backend

```bash
cd packages/backend
npm install && npm run build && npm start
# [trickle] Backend listening on http://localhost:4888
```

### 2. Initialize your project

```bash
cd your-project
npx trickle init
```

This configures everything:
- Creates `.trickle/` with type placeholder files
- Updates `tsconfig.json` to include generated types
- Adds npm scripts (`trickle:start`, `trickle:dev`, `trickle:client`, `trickle:mock`)
- Updates `.gitignore`

### 3. Start your app with instrumentation

```bash
npm run trickle:start
```

This uses `node -r trickle/register` under the hood — zero code changes to your app.

### 4. Start type generation (in another terminal)

```bash
npm run trickle:dev
```

This watches for new type observations and regenerates `.trickle/types.d.ts` automatically. Types appear in VS Code as you make requests.

### 5. Explore with the CLI

```bash
npx trickle functions            # List all instrumented functions
npx trickle errors               # See what's failing
npx trickle errors 1             # Inspect error with full type context
npx trickle types processOrder   # See captured runtime types
npx trickle codegen --client     # Generate a typed API client
npx trickle mock                 # Start a mock API server
npx trickle tail                 # Live stream of events
```

---

## Zero-Code Instrumentation

The easiest way to use trickle — no code changes at all. Just add a flag to your start command.

### Node.js

```bash
node -r trickle/register app.js
```

This patches `require('express')` so every Express app created is automatically instrumented. All route handlers are wrapped to capture request/response types.

### Python

```bash
python -m trickle app.py
```

This installs import hooks that patch Flask and FastAPI constructors. Any app created after import is automatically instrumented.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRICKLE_BACKEND_URL` | Backend URL | `http://localhost:4888` |
| `TRICKLE_ENABLED` | Set to `0` or `false` to disable | `true` |
| `TRICKLE_DEBUG` | Set to `1` for debug logging | `false` |
| `TRICKLE_ENV` | Override detected environment name | auto-detected |

### Testing it

```bash
# Terminal 1: Start backend
cd packages/backend && npm start

# Terminal 2: Start your Express app with zero-code instrumentation
TRICKLE_DEBUG=1 node -r trickle/register your-app.js

# Terminal 3: Make requests and watch types appear
curl http://localhost:3000/api/users
npx trickle functions    # See captured routes
npx trickle codegen      # See generated types
```

---

## One-Liner Instrumentation

If you prefer explicit instrumentation, add one line to your app:

### Express

```javascript
const express = require('express');
const { instrument, configure } = require('trickle');

const app = express();
app.use(express.json());

instrument(app);  // ← one line

app.get('/api/users', (req, res) => { ... });
app.post('/api/orders', (req, res) => { ... });
```

`instrument(app)` must be called **before** defining routes. It patches `app.get`, `app.post`, etc. to wrap every handler.

### FastAPI

```python
from fastapi import FastAPI
from trickle import instrument

app = FastAPI()
instrument(app)  # ← one line

@app.get("/api/users")
async def get_users(): ...
```

### Flask

```python
from flask import Flask
from trickle import instrument

app = Flask(__name__)
instrument(app)  # ← one line

@app.route("/api/users")
def get_users(): ...
```

### Django

```python
from trickle import instrument_django
from myapp.urls import urlpatterns

instrument_django(urlpatterns)
```

### Testing it

```bash
# Terminal 1: Start backend
cd packages/backend && npm start

# Terminal 2: Run the Express E2E test
node test-express-e2e.js

# Terminal 3: See the captured types
npx trickle functions
npx trickle codegen
```

---

## Manual Instrumentation

For non-framework code (utility functions, Lambda handlers, etc.), wrap individual functions:

### JavaScript

```javascript
const { trickle, configure } = require('trickle');

configure({ backendUrl: 'http://localhost:4888' });

const processOrder = trickle(function processOrder(order) {
  const total = order.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return { orderId: order.id, total, status: 'processed' };
});

processOrder({ id: 'ORD-123', items: [{ price: 29.99, quantity: 2 }] });
```

### Python

```python
from trickle import trickle, configure

configure(backend_url='http://localhost:4888')

@trickle
def process_order(order):
    total = sum(i['price'] * i['quantity'] for i in order['items'])
    return {'order_id': order['id'], 'total': total, 'status': 'processed'}
```

### AWS Lambda

```javascript
const { trickleHandler } = require('trickle');

exports.handler = trickleHandler(async (event, context) => {
  const order = JSON.parse(event.body);
  return { statusCode: 200, body: JSON.stringify(await processOrder(order)) };
});
```

### Testing it

```bash
# Terminal 1: Start backend
cd packages/backend && npm start

# Terminal 2: Run the basic E2E test
node test-e2e.js

# Terminal 3: Explore
npx trickle functions
npx trickle types processOrder
npx trickle errors
```

---

## Code Generation

Generate TypeScript/Python type definitions from runtime observations.

### TypeScript types

```bash
# Generate to stdout
npx trickle codegen

# Write to file
npx trickle codegen --out .trickle/types.d.ts

# Watch mode — auto-regenerate on new observations
npx trickle codegen --watch --out .trickle/types.d.ts

# Filter by environment
npx trickle codegen --env prod
```

Output example:

```typescript
export interface GetApiUsersOutput {
  users: GetApiUsersOutputUsers[];
  total: number;
}

export interface PostApiOrdersInput {
  customer: string;
  items: PostApiOrdersInputItems[];
}

export declare function getApiUsers(): GetApiUsersOutput;
export declare function postApiOrders(input: PostApiOrdersInput): PostApiOrdersOutput;
```

### Python type stubs

```bash
npx trickle codegen --python --out .trickle/types.pyi
```

### Typed API client

Generate a fully-typed `fetch`-based API client from observed routes:

```bash
npx trickle codegen --client --out .trickle/api-client.ts
```

Output example:

```typescript
export function createTrickleClient(baseUrl: string) {
  return {
    getApiUsers: (): Promise<GetApiUsersOutput> =>
      request<GetApiUsersOutput>("GET", "/api/users", undefined),

    getApiUsersId: (id: string): Promise<GetApiUsersIdOutput> =>
      request<GetApiUsersIdOutput>("GET", `/api/users/${id}`, undefined),

    postApiOrders: (input: PostApiOrdersInput): Promise<PostApiOrdersOutput> =>
      request<PostApiOrdersOutput>("POST", "/api/orders", input),
  };
}

export type TrickleClient = ReturnType<typeof createTrickleClient>;
```

Usage:

```typescript
import { createTrickleClient } from './.trickle/api-client';

const api = createTrickleClient('http://localhost:3000');
const users = await api.getApiUsers();          // fully typed!
const order = await api.postApiOrders({         // input autocomplete!
  customer: 'Alice',
  items: [{ name: 'Widget', price: 29.99, quantity: 2 }],
});
```

### Testing codegen

```bash
# Terminal 1: Start backend
cd packages/backend && npm start

# Terminal 2: Run the Express E2E test to populate types
node test-express-e2e.js

# Terminal 3: Generate and validate
npx trickle codegen --out /tmp/types.d.ts
npx tsc --noEmit --strict /tmp/types.d.ts    # Should pass

npx trickle codegen --client --out /tmp/client.ts
npx tsc --noEmit --strict /tmp/client.ts      # Should pass

npx trickle codegen --python --out /tmp/types.pyi
python3 -c "import ast; ast.parse(open('/tmp/types.pyi').read())"  # Should pass
```

Or run the dedicated E2E test:

```bash
node test-client-e2e.js
```

---

## Mock Server

Start an instant mock API server from runtime-observed types and sample data:

```bash
npx trickle mock
npx trickle mock --port 8080
npx trickle mock --no-cors
```

Output:

```
  Trickle Mock Server

  Routes (from runtime observations):
    GET     /api/products        (sample from 2m ago)
    GET     /api/products/:id    (sample from 2m ago)
    POST    /api/cart/add        (sample from 1m ago)
    DELETE  /api/cart/:cartId    (sample from 1m ago)

  Listening on http://localhost:3000
  CORS enabled (Access-Control-Allow-Origin: *)
```

Features:
- Serves all observed routes with real sample data
- **Path parameter substitution** — `/api/products/42` returns `id: 42`
- CORS enabled by default for frontend development
- Colored request logging
- 404 with helpful error for unknown routes

### Testing the mock server

```bash
# Terminal 1: Start backend
cd packages/backend && npm start

# Terminal 2: Populate types (run any E2E test)
node test-express-e2e.js

# Terminal 3: Start mock server
npx trickle mock --port 3000

# Terminal 4: Query the mock
curl http://localhost:3000/api/users
curl http://localhost:3000/api/users/42
curl -X POST http://localhost:3000/api/orders -H 'Content-Type: application/json' -d '{"customer":"Alice"}'
```

Or run the dedicated E2E test:

```bash
node test-mock-e2e.js
```

---

## CLI Reference

### `trickle init`

Set up trickle in your project.

```bash
npx trickle init
npx trickle init --dir /path/to/project
npx trickle init --python
```

| Flag | Description |
|------|-------------|
| `--dir <path>` | Project directory (defaults to cwd) |
| `--python` | Set up for a Python project |

What it does:
- Creates `.trickle/` with `types.d.ts` and `api-client.ts` placeholders
- Updates `tsconfig.json` to include `.trickle` in `include`
- Adds npm scripts: `trickle:dev`, `trickle:start`, `trickle:client`, `trickle:mock`
- Updates `.gitignore`
- Idempotent — safe to run multiple times

### `trickle functions`

List all instrumented functions.

```bash
npx trickle functions
npx trickle functions --env prod
npx trickle functions --lang python
npx trickle functions --search processOrder
```

| Flag | Description |
|------|-------------|
| `--env <env>` | Filter by environment |
| `--lang <lang>` | Filter by language (js, python) |
| `--search <query>` | Search by function name |

### `trickle types <function-name>`

Show captured runtime types for a function.

```bash
npx trickle types processOrder
npx trickle types "GET /api/users"
npx trickle types processOrder --diff
npx trickle types processOrder --diff --env1 prod --env2 staging
```

| Flag | Description |
|------|-------------|
| `--env <env>` | Filter snapshots by environment |
| `--diff` | Show diff between latest two snapshots |
| `--env1 <env>` | First environment for cross-env diff |
| `--env2 <env>` | Second environment for cross-env diff |

### `trickle errors [id]`

List errors or inspect a specific error with full type context.

```bash
npx trickle errors
npx trickle errors --since 2h
npx trickle errors --function processOrder
npx trickle errors 42    # Inspect error #42
```

| Flag | Description |
|------|-------------|
| `--env <env>` | Filter by environment |
| `--since <timeframe>` | Time filter: `30s`, `5m`, `2h`, `3d` |
| `--function <name>` | Filter by function name |
| `--limit <n>` | Max results |

### `trickle codegen [function-name]`

Generate type definitions from runtime observations.

```bash
npx trickle codegen                                    # TypeScript to stdout
npx trickle codegen --out .trickle/types.d.ts          # Write to file
npx trickle codegen --python --out .trickle/types.pyi  # Python stubs
npx trickle codegen --client --out .trickle/client.ts  # Typed API client
npx trickle codegen --watch --out .trickle/types.d.ts  # Watch mode
npx trickle codegen --env prod                         # Filter by env
```

| Flag | Description |
|------|-------------|
| `-o, --out <path>` | Write to file instead of stdout |
| `--env <env>` | Filter by environment |
| `--python` | Generate Python TypedDict stubs |
| `--client` | Generate typed fetch-based API client |
| `--watch` | Re-generate when new types are observed |

### `trickle mock`

Start a mock API server from observed runtime types.

```bash
npx trickle mock
npx trickle mock --port 8080
npx trickle mock --no-cors
```

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to listen on (default: 3000) |
| `--no-cors` | Disable CORS headers |

### `trickle tail`

Live stream of events.

```bash
npx trickle tail
npx trickle tail --filter processOrder
```

| Flag | Description |
|------|-------------|
| `--filter <pattern>` | Only show events matching function name |

---

## Python Support

### Installation

```bash
pip install -e packages/client-python
```

### Zero-code instrumentation

```bash
python -m trickle app.py
```

Automatically patches Flask and FastAPI constructors via import hooks.

### One-liner instrumentation

```python
from trickle import instrument
instrument(app)  # Auto-detects FastAPI, Flask, or Django
```

Or use framework-specific functions:

```python
from trickle import instrument_fastapi, instrument_flask, instrument_django

instrument_fastapi(app)
instrument_flask(app)
instrument_django(urlpatterns)
```

### Decorator

```python
from trickle import trickle

@trickle
def process_order(order):
    ...

@trickle
async def fetch_user(user_id):
    ...
```

### Testing Python

```bash
# Terminal 1: Start backend
cd packages/backend && npm start

# Terminal 2: Run Python E2E test
PYTHONPATH=packages/client-python/src python3 test-e2e.py

# Terminal 3: Explore
npx trickle functions --lang python
npx trickle codegen --python
```

---

## Backend

### Running

```bash
cd packages/backend
npm install && npm run build && npm start
# [trickle] Backend listening on http://localhost:4888
```

SQLite database: `~/.trickle/trickle.db` (WAL mode, created automatically).

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/ingest/` | Ingest a single type observation |
| `POST` | `/api/ingest/batch` | Batch ingest multiple observations |
| `GET` | `/api/functions` | List functions |
| `GET` | `/api/functions/:id` | Get function with latest snapshots per env |
| `GET` | `/api/types/:functionId` | List type snapshots |
| `GET` | `/api/types/:functionId/diff` | Diff snapshots between envs or time |
| `GET` | `/api/errors` | List errors |
| `GET` | `/api/errors/:id` | Get error with type context |
| `GET` | `/api/codegen` | Generate type definitions |
| `GET` | `/api/mock-config` | Get mock server configuration |
| `GET` | `/api/tail` | SSE stream of real-time events |
| `GET` | `/api/health` | Health check |

### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `4888` |
| `TRICKLE_BACKEND_URL` | CLI backend URL | `http://localhost:4888` |

The CLI reads backend URL from (in order):
1. `TRICKLE_BACKEND_URL` env var
2. `~/.trickle/config.json` (`{ "backendUrl": "..." }`)
3. Default: `http://localhost:4888`

---

## How It Works

### The type-cache system

When an instrumented function is called:

1. Input arguments are wrapped in transparent Proxy objects (JS) or attribute trackers (Python)
2. The function executes normally — trickle never interferes with behavior
3. After execution, trickle infers a TypeNode representation of inputs and outputs
4. The type signature is hashed (SHA-256, 16 hex chars)
5. If the hash matches the cache, nothing is sent (zero network overhead)
6. If the hash is new, the type signature + one sample of data is sent to the backend
7. If the function threw an error, types are **always** captured regardless of cache

An application handling 1,000,000 requests/sec generates network traffic only when type signatures change — which is almost never in steady state.

### Smart caching

- **Types, not data.** Stores type shapes, not raw data. One sample per signature.
- **Hash-based dedup.** Client-side in-memory cache + server-side database dedup.
- **5-minute heartbeat.** Re-sends to keep `last_seen_at` fresh.
- **Errors always capture.** Full type context on every error for debugging.

### Type system

Both JS and Python produce the same TypeNode representation:

```
TypeNode =
  | { kind: "primitive", name: "string" | "number" | "boolean" | "null" | ... }
  | { kind: "object",    properties: { [key]: TypeNode } }
  | { kind: "array",     element: TypeNode }
  | { kind: "tuple",     elements: TypeNode[] }
  | { kind: "union",     members: TypeNode[] }
  | { kind: "function",  params: TypeNode[], returnType: TypeNode }
  | { kind: "promise",   resolved: TypeNode }
  | { kind: "map",       key: TypeNode, value: TypeNode }
  | { kind: "set",       element: TypeNode }
  | { kind: "unknown" }
```

---

## Architecture

```
┌──────────────────┐     POST /api/ingest/batch     ┌─────────────────────┐
│   JS Client      │ ─────────────────────────────> │                     │
│   (trickle npm)  │                                │   Backend           │
├──────────────────┤                                │   (Express + SQLite)│
│  -r register     │  auto-patches require()        │                     │
└──────────────────┘                                │   Port 4888         │
                                                    │   ~/.trickle/db     │
┌──────────────────┐     POST /api/ingest/batch     │                     │
│  Python Client   │ ─────────────────────────────> │                     │
│  (trickle pip)   │                                │                     │
├──────────────────┤                                │                     │
│  -m trickle      │  auto-patches imports          │                     │
└──────────────────┘                                └─────────┬───────────┘
                                                              │
┌──────────────────┐     REST + SSE                          │
│   CLI            │ <──────────────────────────────────────>│
│   (npx trickle)  │                                         │
├──────────────────┤                                         │
│  init            │  project setup                          │
│  codegen         │  TypeScript/Python/client generation    │
│  mock            │  mock API server from observed types    │
│  functions       │  list observed functions                │
│  types           │  inspect runtime types                  │
│  errors          │  debug errors with type context         │
│  tail            │  live event stream                      │
└──────────────────┘
```

### Monorepo structure

```
trickle/
├── packages/
│   ├── backend/            # Express API + SQLite storage
│   │   └── src/
│   │       ├── db/         # Connection, migrations, queries
│   │       ├── routes/     # ingest, functions, types, errors, tail, codegen, mock
│   │       └── services/   # SSE broker, type differ, type generator
│   │
│   ├── client-js/          # JavaScript instrumentation library
│   │   ├── register.js     # Entry point for node -r trickle/register
│   │   └── src/
│   │       ├── index.ts        # Public API: configure, trickle, instrument, flush
│   │       ├── register.ts     # Auto-instrumentation via Module._load
│   │       ├── express.ts      # Express monkey-patching
│   │       ├── wrap.ts         # Core function wrapping
│   │       ├── proxy-tracker.ts # Deep property access tracking
│   │       ├── type-inference.ts
│   │       ├── type-hash.ts
│   │       ├── cache.ts
│   │       ├── transport.ts    # Batched HTTP with retry
│   │       └── env-detect.ts
│   │
│   ├── client-python/      # Python instrumentation library
│   │   └── src/trickle/
│   │       ├── __init__.py     # Public API
│   │       ├── __main__.py     # python -m trickle runner
│   │       ├── _auto.py        # Auto-instrumentation import hooks
│   │       ├── instrument.py   # FastAPI/Flask/Django instrumentation
│   │       ├── decorator.py    # @trickle decorator
│   │       ├── attr_tracker.py
│   │       ├── type_inference.py
│   │       ├── type_hash.py
│   │       ├── cache.py
│   │       ├── transport.py
│   │       └── env_detect.py
│   │
│   └── cli/                # Developer CLI tool
│       └── src/
│           ├── index.ts        # Commander setup
│           ├── commands/       # init, functions, types, errors, codegen, mock, tail
│           ├── formatters/     # Type and diff formatting
│           └── ui/             # Badges, helpers
│
├── test-e2e.js             # Basic JS client test
├── test-e2e.py             # Basic Python client test
├── test-express-e2e.js     # Express auto-instrumentation test
├── test-client-e2e.js      # Typed API client generation test
├── test-register-e2e.js    # Zero-code register hook test
├── test-register-app.js    # Plain Express app (no trickle code) for register test
├── test-mock-e2e.js        # Mock server test
├── test-init-e2e.js        # trickle init test
├── package.json            # npm workspace root
└── tsconfig.base.json      # Shared TypeScript config
```

### Dependencies

| Package | Dependencies |
|---------|-------------|
| Backend | express, better-sqlite3, cors |
| JS Client | zero runtime dependencies |
| Python Client | requests |
| CLI | chalk, cli-table3, commander |

---

## E2E Tests

Run all E2E tests to verify everything works:

```bash
# Build everything first
npm run build

# Start backend (required for all tests)
cd packages/backend && npm start

# In another terminal, run tests:
node test-e2e.js             # Basic JS instrumentation
node test-express-e2e.js     # Express auto-instrumentation
node test-client-e2e.js      # Typed API client generation
node test-mock-e2e.js        # Mock server
node test-init-e2e.js        # trickle init (creates temp project)

# Self-contained tests (start their own backend):
node test-register-e2e.js    # Zero-code register hook

# Python test:
PYTHONPATH=packages/client-python/src python3 test-e2e.py
```

---

## License

MIT
