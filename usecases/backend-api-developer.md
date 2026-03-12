# Backend API Developer: Auto-Generate Types from Your Running API

You're building an Express, FastAPI, Flask, or Django API. Instead of manually writing TypeScript interfaces or OpenAPI specs, trickle observes your running API and generates accurate types from real traffic.

## Install

```bash
npm install trickle-observe   # JS client
npm install -g trickle-cli    # CLI tools
```

For Python APIs:
```bash
pip install trickle-observe
```

## Quick Start (30 seconds)

### Node.js / Express

No code changes needed. Just prefix your start command:

```bash
trickle run node app.js
```

Or for TypeScript:
```bash
trickle run tsx src/server.ts
```

Hit a few endpoints (`curl http://localhost:3000/api/users`), then check:

```bash
trickle functions
```

```
  ┌─────────────────────────────────────────────────────────┐
  │ Function            │ Module     │ Calls │ Last Seen     │
  ├─────────────────────────────────────────────────────────┤
  │ GET /api/users      │ app        │ 3     │ 2s ago        │
  │ POST /api/users     │ app        │ 1     │ 5s ago        │
  │ GET /api/users/:id  │ app        │ 2     │ 3s ago        │
  └─────────────────────────────────────────────────────────┘
```

### Python / FastAPI

```bash
trickle run uvicorn app:app --reload
```

### Python / Flask

```bash
trickle run python app.py
```

### Python / Django

```bash
trickle run python manage.py runserver
```

All work the same — trickle auto-detects the framework and instruments it.

## Use Case 1: Generate TypeScript Types

After sending some requests through your API:

```bash
trickle codegen
```

Output:
```typescript
export interface GetApiUsersResponse {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

export interface PostApiUsersRequest {
  name: string;
  email: string;
}

export interface PostApiUsersResponse {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}
```

Save to a file:
```bash
trickle codegen -o src/types/api.d.ts
```

## Use Case 2: Generate a Typed API Client

```bash
trickle codegen --client -o src/api-client.ts
```

This generates a fully typed fetch-based client:

```typescript
import { api } from './api-client';

const users = await api.getApiUsers();        // typed as GetApiUsersResponse[]
const user = await api.postApiUsers({ name: 'Alice', email: 'a@b.com' });
                                                // typed as PostApiUsersResponse
```

## Use Case 3: Generate an OpenAPI Spec

```bash
trickle openapi -o openapi.json --title "My API" --api-version "1.0.0"
```

This creates a valid OpenAPI 3.0 spec from observed routes — no manual YAML writing.

## Use Case 4: Auto-Generate During Development

Run your server with live type generation:

```bash
trickle dev
```

Or use watch mode:
```bash
trickle run node app.js --stubs src/
```

Types regenerate automatically as new requests flow through. Your IDE picks up `.d.ts` files immediately.

## Use Case 5: Explicit Instrumentation

If you prefer explicit control over what's observed:

**Express:**
```javascript
import { trickleExpress } from 'trickle-observe/express';

const app = express();
trickleExpress(app);  // call BEFORE defining routes

app.get('/api/users', (req, res) => { ... });
```

**FastAPI:**
```python
from trickle import instrument

app = FastAPI()
instrument(app)

@app.get("/api/users")
async def get_users(): ...
```

**Flask:**
```python
from trickle import instrument

app = Flask(__name__)
instrument(app)

@app.route("/api/users")
def get_users(): ...
```

## Use Case 6: Observe Any Function (Not Just Routes)

```javascript
import { observe, observeFn } from 'trickle-observe';

// Wrap all exports from a module
const db = observe(require('./db'), { module: 'database' });

// Wrap a single function
const processOrder = observeFn(rawProcessOrder, { name: 'processOrder' });
```

```python
from trickle import observe, observe_fn

import db
observed_db = observe(db)

@observe_fn
def process_order(order_id, items): ...
```

Then inspect:
```bash
trickle types processOrder
```

## Use Case 7: CI — Catch Breaking API Changes

Save a type baseline:
```bash
trickle check --save baseline.json
```

In CI, compare against it:
```bash
trickle check --against baseline.json
# Exit code 1 if breaking changes detected
```

## Use Case 8: Proxy Mode (No Code Changes at All)

Don't want to touch the backend code? Run a transparent proxy:

```bash
trickle proxy --target http://localhost:3000 --port 4000
```

Point your frontend at `http://localhost:4000`. All requests pass through to the real backend, but trickle observes the types. Works with any backend in any language.

## More Code Generation Formats

```bash
trickle codegen --zod              # Zod validation schemas
trickle codegen --pydantic         # Pydantic BaseModel classes
trickle codegen --json-schema      # JSON Schema definitions
trickle codegen --react-query      # TanStack React Query hooks
trickle codegen --swr              # SWR data-fetching hooks
trickle codegen --msw              # Mock Service Worker handlers
trickle codegen --graphql          # GraphQL SDL schema
trickle codegen --trpc             # tRPC router definitions
trickle codegen --axios            # Typed Axios client
trickle codegen --class-validator  # NestJS class-validator DTOs
trickle codegen --handlers         # Typed Express handler types
```

## Project Setup

One-time setup for a project:

```bash
trickle init
```

This:
- Creates `.trickle/` directory
- Updates `tsconfig.json` to include trickle types
- Adds npm scripts (`trickle:dev`, `trickle:client`, `trickle:mock`)
- Updates `.gitignore`
