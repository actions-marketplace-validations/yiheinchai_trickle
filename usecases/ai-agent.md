# AI Coding Agent: Debug with Runtime Context Instead of console.log

You're an AI coding agent (Claude Code, Cursor, Copilot, etc.) debugging an application. Instead of asking the user to add console.log statements and re-run, use trickle's cached runtime data to understand what happened at runtime.

## Setup

When you encounter a project with `.trickle/` directory or `CLAUDE.md` mentioning trickle, the runtime data is already available.

If not set up yet:
```bash
npm install -g trickle-cli && npm install trickle-observe
trickle init     # sets up project + creates CLAUDE.md
trickle run node app.js   # captures runtime data
```

---

## Use Case 1: Understanding Variable Values Without Running Code

**Before trickle (traditional debugging):**
```
Agent: "I need to add a console.log to see what `user` contains at line 25"
User: *adds console.log, re-runs app, copies output*
Agent: "OK, now I can see the issue..."
```

**With trickle:**
```bash
trickle context src/api.ts:25
```

Output:
```
## Variables (runtime values)
### src/api.ts
- L13 `user`: `{ id: number, name: string, email: string }` = `{"id":1,"name":"Alice",...}`
- L18 `users`: `User[]` = `[{"id":1,...}, {"id":2,...}]`
- L19 `count`: `number` = `3`
- L25 `user`: `undefined` = `null`
```

The agent immediately sees that `user` is `undefined` at line 25 — the bug is a failed lookup.

---

## Use Case 2: Understanding Function Signatures

```bash
trickle context --function handleCreateUser
```

Output:
```
## Functions
- `api.handleCreateUser(body: { name: string, email: string }) -> { success: boolean, data: User }`
  Sample call: [{"name":"Alice","email":"alice@co.com"}] -> {"success":true,"data":{"id":1,...}}
```

The agent sees exact parameter types and sample inputs/outputs — no need to trace through the code.

---

## Use Case 3: Debugging Errors

```bash
trickle context --errors
```

Shows variable values near where errors occurred — like a local Sentry.

---

## Use Case 4: Cross-File Data Flow

```bash
trickle context --compact
```

Compact output showing all variables across all files — perfect for understanding how data flows through the application:

```
### src/db.ts
  L9 users: User[] = []
  L13 user: User = {"id":1,"name":"Alice",...}

### src/api.ts
  L13 user: User = {"id":1,"name":"Alice",...}
  L19 count: number = 3

### src/index.ts
  L4 r1: ApiResponse = {"success":true,"data":{"id":1,...}}
```

---

## Use Case 5: JSON Output for Programmatic Analysis

```bash
trickle context src/api.ts --json
```

Returns structured JSON that agents can parse:
```json
{
  "variables": [
    {"file": "src/api.ts", "line": 13, "name": "user", "type": "{ id: number, ... }", "value": {"id": 1, ...}},
    {"file": "src/api.ts", "line": 19, "name": "count", "type": "number", "value": 3}
  ],
  "functions": [
    {"name": "handleCreateUser", "module": "api", "params": [...], "returns": "..."}
  ]
}
```

---

## Agent Workflow

1. **User reports a bug** → Agent runs `trickle context <relevant-file>`
2. **Agent sees runtime values** → Understands actual data flow without re-running
3. **Agent identifies root cause** → Variable was undefined, wrong type, etc.
4. **Agent fixes the code** → No console.log iteration needed

This reduces debugging from multiple "add log → run → read output" cycles to a single command.

---

## Integration with CLAUDE.md

When `trickle init` is run, it creates a `CLAUDE.md` with instructions for agents:

```markdown
## Debugging with Runtime Data

This project uses **trickle** for runtime type observability.
Use cached runtime data instead of adding console.log/print statements:

    trickle context src/api.ts        # variable values for a file
    trickle context src/api.ts:42     # values near a specific line
    trickle context --compact          # minimal output
```

AI agents that read `CLAUDE.md` (like Claude Code) will automatically know to use `trickle context` instead of adding debug prints.
