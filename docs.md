# Trickle Documentation

> Single-source-of-truth documentation for the trickle runtime type observability platform.
>
> Features are marked **[CORE]** (actively used and promoted) or **[ARCHIVED]** (still in the codebase but not part of the promoted product surface).

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [CLI Commands](#cli-commands)
4. [Python Client](#python-client)
5. [JS Client](#js-client)
6. [VSCode Extension](#vscode-extension)
7. [Backend](#backend)

---

## Overview

Trickle is a runtime type observability tool. It watches your code as it runs, captures the actual types of every variable, function argument, and return value, then surfaces that information in your editor and CLI. No type annotations required -- trickle observes what your code actually does.

The primary workflow:

1. Run your app with `trickle run <command>`
2. Trickle instruments your code via AST transformation, capturing types, tensor shapes, sample values, errors, and ML training metrics
3. Observations are written to `.trickle/variables.jsonl` (local) and optionally to the backend SQLite database
4. The VSCode extension reads the JSONL file and renders inline type hints, hover tooltips, error diagnostics, and ML training metrics
5. The CLI provides `trickle hints` to output annotated source for AI agents, and `trickle vars` to inspect captured data

### Packages

| Package | Path | Description |
|---------|------|-------------|
| `trickle` (JS client) | `packages/client-js` | Zero-dep JS/TS instrumentation library |
| `trickle` (Python client) | `packages/client-python` | Python instrumentation library |
| `trickle-cli` | `packages/cli` | CLI tool (bin: `trickle`) |
| `trickle-backend` | `packages/backend` | Express + SQLite backend on port 4888 |
| `trickle-vscode` | `packages/vscode-extension` | VSCode extension for inline hints |

---

## Architecture

```
  Your Code
     |
     v
  trickle run  ──> AST transform + import hooks
     |                    |
     |         writes     v
     |         .trickle/variables.jsonl   <──  VSCode Extension reads
     |         .trickle/errors.jsonl      <──  VSCode Extension reads
     |                    |
     v                    v
  Backend (port 4888)     CLI (trickle hints, trickle vars)
  SQLite: ~/.trickle/trickle.db
```

### Data Flow

- **Python**: `observe_runner.py` installs a `builtins.__import__` hook that patches all user module functions with `observe_fn`. The `_entry_transform.py` module uses AST transformation to instrument the entry file itself (since it is executed via `runpy.run_path()` and never goes through `__import__`). Variable assignments get `_trickle_tv()` calls inserted after them.
- **JavaScript**: `observe-register.ts` patches `Module._compile` to transform source code, inserting `__trickle_tv()` calls after variable declarations and wrapping function exports.
- **Notebooks**: `%load_ext trickle` registers an IPython cell transformer that injects tracing calls into each cell before execution.
- **Local storage**: All observations are written to `.trickle/variables.jsonl` as newline-delimited JSON. Errors go to `.trickle/errors.jsonl`. The VSCode extension watches these files with a debounced `FileSystemWatcher`.

---

## CLI Commands

The CLI is registered as `trickle` (package `trickle-cli`). Commands are defined in `packages/cli/src/index.ts`.

> **Note**: Only two command implementation files exist in `packages/cli/src/commands/`: `run.ts` and `hints.ts`. All other commands are registered in `index.ts` but their `.ts` implementation files have been deleted. They are marked [ARCHIVED] below.

### [CORE] `trickle run [command...]`

Run any command or file with universal type observation. Zero code changes needed.

```bash
trickle run python train.py
trickle run node server.js
trickle run pytest
trickle run                    # auto-detects entry point
```

**Options:**
- `--module <name>` -- Module name for captured functions
- `--include <patterns>` -- Comma-separated substrings; only observe matching modules
- `--exclude <patterns>` -- Comma-separated substrings; skip matching modules
- `--stubs <dir>` -- Auto-generate `.d.ts`/`.pyi` type stubs after the run
- `--annotate <path>` -- Auto-annotate file/directory with types after the run
- `-w, --watch` -- Watch source files and re-run on changes

**Implementation** (`packages/cli/src/commands/run.ts`):
- Auto-detects language (Python vs Node) from the command or file extension
- Auto-detects entry point from `package.json`, `manage.py`, `app.py`, etc. if no command given
- For Python: spawns `python -c "from trickle.observe_runner import main; main()" <script>`
- For Node: spawns `node -r trickle/observe <script>`
- Starts the trickle backend automatically if not already running
- After the run completes, prints a summary of observed functions, errors, and types
- Can auto-generate stubs and annotate source files post-run

### [CORE] `trickle hints [file]`

Output source code with inline type hints from runtime observations. Designed for AI agents that need runtime type context.

```bash
trickle hints src/model.py           # all hints for a file
trickle hints src/model.py --values  # include sample values
trickle hints --errors               # show variables at crash time
trickle hints                        # all observed files
```

**Options:**
- `--values` -- Include sample values alongside types
- `--errors` -- Error mode: show variables at crash time with the values that caused the error
- `--show <mode>` -- What to show inline: `types`, `values`, or `both` (default: `both` in error mode, `types` otherwise)

**Implementation** (`packages/cli/src/commands/hints.ts`):
- Reads `.trickle/variables.jsonl` to get variable observations
- Finds the variable name in each source line and inserts type annotations inline after it
- Handles Python assignment patterns (bare assignment, for-loop variables, with-as, function parameters)
- Supports notebook cell paths (`__notebook__cell_N.py`), resolving back to `.ipynb` files
- In error mode, reads `error_snapshot` records and maps them back to original assignment lines
- Renders Tensor shapes as `Tensor(shape=(4,8,32), dtype=float32)`, DataFrames as `DataFrame(100x5)`, etc.
- Outputs fenced code blocks suitable for LLM consumption

### [CORE] `trickle vars`

Show captured variable types and sample values from runtime observations.

```bash
trickle vars                     # all variables
trickle vars -f src/model.py     # filter by file
trickle vars --tensors           # only tensor/ndarray variables
trickle vars --json              # raw JSON output
```

**Options:**
- `-f, --file <file>` -- Filter by file path or module name
- `-m, --module <module>` -- Filter by module name
- `--json` -- Output raw JSON
- `--tensors` -- Show only tensor/ndarray variables

### [CORE] `trickle init`

Set up trickle in your project. Configures types, tsconfig, and npm scripts.

```bash
trickle init
trickle init --python
trickle init --dir /path/to/project
```

**Options:**
- `--dir <path>` -- Project directory (defaults to cwd)
- `--python` -- Set up for a Python project

### [CORE] `trickle layers`

Per-layer activation and gradient breakdown for `nn.Sequential` models.

```bash
trickle layers
trickle layers -f src/model.py
trickle layers --watch
trickle layers --json
```

**Options:**
- `-f, --file <file>` -- Filter by source file path
- `-w, --watch` -- Watch mode: refresh on file changes
- `--json` -- Output structured JSON for agent consumption

### [CORE] `trickle mcp-server`

Start an MCP (Model Context Protocol) server for AI agent integration via stdio transport.

```bash
trickle mcp-server
```

### [ARCHIVED] CLI Commands (implementation files deleted)

The following commands are still registered in `packages/cli/src/index.ts` but their implementation `.ts` files no longer exist in `packages/cli/src/commands/`. They import from paths that would fail at runtime:

| Command | Description |
|---------|-------------|
| `trickle functions` | List observed functions |
| `trickle types <name>` | Show type snapshots for a function |
| `trickle errors [id]` | List errors or show error detail |
| `trickle tail` | Stream live events from the backend |
| `trickle codegen [name]` | Generate TypeScript/Python type definitions |
| `trickle context [file:line]` | Show runtime context for AI agents |
| `trickle tool-schema [name]` | Generate LLM tool calling schemas |
| `trickle diff` | Show type drift across all functions |
| `trickle openapi` | Generate OpenAPI 3.0 spec from observed routes |
| `trickle check` | Detect breaking API changes against a baseline |
| `trickle mock` | Start a mock API server from observed data |
| `trickle test [command]` | Run tests with observability / generate test files |
| `trickle dashboard` | Open the web dashboard |
| `trickle proxy` | Transparent reverse proxy that captures API types |
| `trickle export` | Generate all output formats (CSV, OTLP) |
| `trickle coverage` | Type observation health report |
| `trickle replay` | Replay captured API requests as regression tests |
| `trickle docs` | Generate API documentation from observed types |
| `trickle sample [route]` | Generate test fixtures from observed data |
| `trickle audit` | Analyze types for quality issues / compliance |
| `trickle capture <method> <url>` | Capture types from a live API endpoint |
| `trickle search <query>` | Search across all observed types |
| `trickle auto` | Auto-detect project deps and generate relevant types |
| `trickle validate <method> <url>` | Validate API response against observed types |
| `trickle watch` | Watch for new type observations and auto-regenerate |
| `trickle infer [file]` | Infer types from a JSON file or stdin |
| `trickle overview` | Compact API overview with inline type signatures |
| `trickle trace <method> <url>` | Make HTTP request with inline type annotations |
| `trickle pack` | Export observed types as a portable bundle |
| `trickle unpack <file>` | Import types from a packed bundle |
| `trickle stubs <dir>` | Generate `.d.ts` and `.pyi` sidecar stubs |
| `trickle dev [command]` | Start app with auto-instrumentation and live codegen |
| `trickle annotate` | Annotate source files with types |
| `trickle lambda` | Lambda deployment helpers (setup/layer/pull) |
| `trickle rn` | React Native helpers (setup/ip) |
| `trickle next` | Next.js helpers (setup) |
| `trickle python` | Python project helpers (setup) |
| `trickle monitor` | Analyze runtime data for performance issues |
| `trickle rules` | Manage alerting rules (init/list) |
| `trickle status` | Quick overview of available observability data |
| `trickle agent [command]` | Autonomous debugging agent |
| `trickle ci [command]` | CI/CD integration with GitHub/GitLab annotations |
| `trickle doctor` | Comprehensive health check |
| `trickle summary` | Post-run summary in JSON |
| `trickle explain <file>` | Understand a file via runtime data |
| `trickle demo` | Self-running showcase of features |
| `trickle ticket` | Create tickets in Jira/Linear/GitHub Issues |
| `trickle changelog` | Auto-generate API changelog from type diffs |
| `trickle security` | Scan runtime data for security issues |
| `trickle deps` | Visualize module dependency graph |
| `trickle cost` | Estimate cloud cost per function (Lambda pricing) |
| `trickle waterfall` | Generate interactive request waterfall timeline |
| `trickle anomaly` | Detect performance anomalies against baseline |
| `trickle diff-runs` | Compare two trickle runs |
| `trickle fix` | Generate code fix suggestions |
| `trickle flamegraph` | Generate interactive flamegraph from call traces |
| `trickle watch-alerts` | Continuous monitoring with JSON events |
| `trickle cloud` | Cloud sync (login/push/pull/share/projects/status) |
| `trickle cloud team` | Team management (create/list/info/invite/remove/add-project) |
| `trickle metrics` | APM-style metrics (latency percentiles, throughput) |
| `trickle slo` | SLO monitoring (init/check) |
| `trickle heal` | Agent auto-remediation |
| `trickle verify` | Verify a fix against saved baseline |
| `trickle dashboard-local` | Self-contained local dashboard |
| `trickle llm` | Show captured LLM/AI API calls |
| `trickle why [query]` | Causal debugging -- trace back to root cause |
| `trickle memory` | Show captured agent memory operations |
| `trickle benchmark [command]` | Multi-trial reliability testing |
| `trickle playback` | Replay agent execution step-by-step |
| `trickle cost-report` | LLM cost report |
| `trickle eval` | Agent evaluation |
| `trickle compliance` | Compliance audit report |

---

## Python Client

**Package**: `trickle` (installed from `packages/client-python`)

### [CORE] Core Modules

#### `__init__.py`

Public API surface. Exports:
- `trickle` -- decorator for wrapping functions
- `configure`, `flush` -- transport configuration
- `instrument`, `instrument_fastapi`, `instrument_flask`, `instrument_django`, `instrument_litestar` -- framework instrumentation
- `observe`, `observe_fn` -- universal observation
- `progress` -- training progress reporting
- `load_ipython_extension` / `unload_ipython_extension` -- IPython `%load_ext trickle` entry point
- All observer patch functions (see Observers section below)

#### `type_inference.py` [CORE]

Infers a `TypeNode` dictionary from any Python runtime value.

```python
from trickle.type_inference import infer_type

node = infer_type(value, max_depth=5)
# Returns: {"kind": "object", "class_name": "Tensor", "properties": {"shape": ..., "dtype": ...}}
```

Key features:
- Handles primitives, lists, tuples, dicts, sets, dataclasses, NamedTuples
- Special handling for PyTorch `Tensor` (shape, dtype, device, grad, requires_grad)
- Special handling for NumPy `ndarray` (shape, dtype)
- Special handling for Pandas `DataFrame`/`Series` (rows, cols, dtypes)
- Special handling for HuggingFace `Dataset`/`DatasetDict`
- Circular reference detection via `_seen` set of `id()` values
- `max_depth` prevents infinite recursion on deeply nested structures
- `_type_nodes_equal()` for structural comparison (treats Tensor/ndarray/DataFrame as display-only types)

#### `notebook.py` [CORE]

IPython/Jupyter notebook integration.

```python
%load_ext trickle
# All subsequent cells are traced automatically
```

How it works:
- Registers an IPython AST transformer that instruments each cell before execution
- After every variable assignment, injects `_trickle_tv()` calls
- Captures runtime types, tensor shapes, and sample values
- Writes to `.trickle/variables.jsonl` which the VSCode extension picks up
- Tracks shape changes between cells (previous vs current shapes)
- Aggregates scalar tensor values in loops (first, last, min, max, count)
- Per-line sample count limit (5) and value-aware deduplication

#### `_entry_transform.py` [CORE]

AST transformation for deep observation of the entry file.

When `trickle run script.py` is used, the entry file is executed via `runpy.run_path()` -- `builtins.__import__` never fires for functions defined in the entry file itself. This module:

1. Parses the entry file's source with `ast`
2. Finds all function/async function definitions
3. Inserts wrapper calls after each definition
4. Inserts variable trace calls after each assignment statement
5. Compiles and executes the transformed AST

Also installs a traceback rewriter (`sys.excepthook`) that maps temp file paths and inflated line numbers back to the original source.

#### `observe_runner.py` [CORE]

The main runner for `trickle run` with Python.

```bash
python -c "from trickle.observe_runner import main; main()" script.py
```

- Clears previous `.trickle/variables.jsonl` and `.trickle/errors.jsonl`
- Patches `sys.stdout`/`sys.stderr` to capture console output to `console.jsonl`
- Installs the `builtins.__import__` hook for auto-observation
- Runs the target script via `_entry_transform` (AST-transformed execution)
- Catches exceptions and writes error context

#### `_error_context.py` [CORE]

Prints tensor shape context when user code crashes.

- Reads `.trickle/variables.jsonl` and the exception traceback
- Shows relevant tensor shapes near the crash site
- Writes error info to `.trickle/errors.jsonl` for VSCode diagnostics
- Captures local variables at the crash frame

#### `transport.py`

Batched HTTP transport to the backend.

- Sends payloads to `POST /api/ingest/batch` with `{ payloads: batch }`
- Uses camelCase payload keys with nested error object
- Sets `"language": "python"`
- Configurable batch interval and backend URL

#### `decorator.py`

The `@trickle` decorator for wrapping individual functions.

#### `types.py`

TypeNode type definitions and related structures.

#### `type_hash.py`

Deterministic hashing of TypeNode structures for deduplication.

#### `cache.py`

Caching layer to avoid re-sending duplicate type observations.

#### `observe.py`

Universal observation: `observe(module)` wraps all exported functions in a module, `observe_fn(fn)` wraps a single function.

#### `call_trace.py`

Call trace recording -- captures function call graphs.

#### `trace_context.py`

Request-scoped trace context for correlating observations.

#### `request_context.py`

Request context management for web framework instrumentation.

#### `attr_tracker.py`

Tracks attribute access patterns on objects.

#### `env_detect.py`

Detects the runtime environment (development, production, test, etc.).

#### `env_capture.py`

Captures environment variables and system info.

#### `progress.py`

`trickle.progress()` -- reports training metrics (epoch, loss, lr, etc.) that show up in the VSCode status bar and as inlay hints.

#### `_run_summary.py`

Generates a post-run summary of all observations.

#### `_auto_var_tracer.py`

Automatic variable tracing -- inserts trace calls into function bodies.

#### `_trace_import_hook.py`

`sys.meta_path` hook for zero-code instrumentation (`python -m trickle`).

#### `_auto_codegen.py`

Auto-generates type stubs from observations.

#### `auto_run.py`

Entry point for auto-run mode.

### [CORE] ML Hooks

These modules patch PyTorch functions to emit training-related observations. All write to `.trickle/variables.jsonl` with specific `kind` values that the VSCode extension renders as inlay hints.

#### `_backward_hook.py` [CORE]

Patches `torch.Tensor.backward()` to emit gradient flow information.

After `loss.backward()`, walks the caller's frame to find `nn.Module` variables and emits:
- Per-layer gradient norms grouped by top-level layer name
- `kind: "gradient"` records with vanishing/exploding detection
- Thresholds: vanishing < 1e-6, exploding > 100.0

VSCode shows: `loss.backward()  # grad: 12 layers | max=0.34 min=0.001 | 1 vanishing`

#### `_activation_hook.py` [CORE]

Registers a global forward hook on `nn.Module` to emit activation statistics.

After each module forward pass, captures:
- Mean, std, min, max, numel, shape of output tensor
- Dead ReLU detection (>50% zeros)
- Saturation detection for tanh/sigmoid (>50% of |values| > 0.9)
- Vanishing activations (std < 1e-5)
- Exploding activations (max |value| > 1e3)

Rate-limited to every N forward calls (configurable via `TRICKLE_ACT_EVERY`, default 20).

#### `_loss_probe_hook.py` [CORE]

Patches `torch.Tensor.backward()` to probe loss patterns.

Captures loss value on each backward call and detects patterns over a rolling window of 20 steps:
- `decreasing` -- normal healthy training
- `plateau` -- coefficient of variation < 1%
- `oscillating` -- >60% of consecutive diffs change sign
- `increasing` -- positive linear trend
- `diverging` -- NaN/inf/sustained increase

VSCode shows: `loss.backward()  # 2.34 avg=2.41 [decreasing]`

#### `_optimizer_hook.py` [CORE]

Patches PyTorch optimizer `.step()` to emit optimizer state records.

After each step: gradient norm, weight update magnitude, per-group parameter stats.

VSCode shows: `optimizer.step()  # grad=0.342 | update=0.0034`

#### `_lr_scheduler_hook.py` [CORE]

Patches LR scheduler `.step()` to emit learning rate records.

VSCode shows: `scheduler.step()  # lr=2.34e-04 | epoch=3`

#### `_checkpoint_hook.py` [CORE]

Patches `torch.save` and `save_pretrained` to emit checkpoint records.

Scans the caller's frame for training metrics (epoch, step, loss).

VSCode shows: `torch.save(model, 'ckpt.pt')  # epoch=3 | step=1500 | loss=0.342`

#### `_attention_hook.py` [CORE]

Patches `torch.nn.functional.softmax` to capture attention weight statistics.

Intercepts softmax calls on 4D tensors `(B, H, T, T)` and computes:
- Mean entropy per head
- Dead heads (entropy close to log(T) -- uniform distribution)
- Sharp heads (entropy < 0.1*log(T) -- very peaked)
- Mean position attended to

#### `_dataloader_hook.py` [CORE]

Patches DataLoader iterators to emit batch shape and throughput records.

Handles tuple/list batches, dict batches (HuggingFace), and single-tensor batches.

VSCode shows: `for batch in train_loader:  # [32,3,224,224] float32, [32] int64`

Also tracks throughput: `# 1.23k smp/s | 38.5 bat/s | ETA 0:12`

### Observers

#### `llm_observer.py`

Patches LLM client libraries to capture API calls, tokens, cost, and latency.

- `patch_openai()` -- OpenAI `chat.completions.create`
- `patch_anthropic()` -- Anthropic `messages.create`
- `patch_gemini()` -- Google Gemini
- `patch_mistral()` -- Mistral AI
- `patch_cohere()` -- Cohere
- `patch_llms()` -- All of the above

Writes to `.trickle/llm.jsonl`.

#### `db_observer.py`

Patches database drivers to capture queries.

- `patch_sqlite3()` -- sqlite3 cursor execute
- `patch_psycopg2()` -- PostgreSQL
- `patch_sqlalchemy()` -- SQLAlchemy engine
- `patch_redis()` -- Redis commands
- `patch_pymongo()` -- MongoDB operations

Writes to `.trickle/queries.jsonl`.

#### `agent_observer.py`

Patches agent frameworks to capture agent execution.

- `patch_langchain()` -- LangChain chains and agents
- `patch_crewai()` -- CrewAI crews and tasks

Writes to `.trickle/agents.jsonl`.

#### `openai_agents_observer.py`

- `patch_openai_agents()` -- OpenAI Agents SDK

#### `mcp_observer.py`

Patches MCP (Model Context Protocol) libraries.

- `patch_mcp_client()` -- MCP client calls
- `patch_mcp_server()` -- MCP server handlers
- `patch_mcp()` -- Both client and server

#### `memory_observer.py`

Patches memory/state management libraries.

- `patch_mem0()` -- Mem0 memory operations
- `patch_langgraph_checkpointer()` -- LangGraph checkpoint operations
- `patch_memory()` -- All memory libraries

Writes to `.trickle/memory.jsonl`.

#### `http_observer.py`

- `patch_http()` -- Patches `requests` and `httpx` to capture HTTP calls

#### `log_observer.py`

Captures Python logging output.

#### `claude_agent_observer.py`

Observer for Claude agent interactions.

#### `profile_observer.py`

Performance profiling observer.

### Auto-instrumentation

#### `instrument.py`

Framework-specific instrumentation:
- `instrument(app)` -- auto-detects Flask/FastAPI/Django/Litestar
- `instrument_fastapi(app)` -- FastAPI middleware
- `instrument_flask(app)` -- Flask `add_url_rule` patch
- `instrument_django(urlpatterns)` -- Django URL pattern wrapping
- `instrument_litestar(app)` -- Litestar middleware

#### `_auto.py`

Auto-patching entry point -- patches all known libraries on import.

#### `auto.py`

`import trickle.auto` -- triggers all auto-instrumentation (ML hooks, observers, framework detection).

#### `_observe_auto.py`

`builtins.__import__` hook that patches all user module functions on import.

#### `__main__.py`

`python -m trickle` entry point -- installs `sys.meta_path` hook for zero-code instrumentation.

#### `pytest_plugin.py`

Pytest plugin for test instrumentation.

---

## JS Client

**Package**: `trickle` (installed from `packages/client-js`)

### [CORE] Core Modules

#### `index.ts`

Main entry point and public API.

```typescript
import { trickle, configure, flush } from 'trickle';

// Configure
configure({ backendUrl: 'http://localhost:4888', environment: 'production' });

// Wrap a function
const wrapped = trickle(myFunction);
const wrapped = trickle(myFunction, { name: 'myFn', module: 'api' });
const wrapped = trickle('myFunction', myFunction);

// Lambda handler
const handler = trickleHandler(myHandler);
```

Exports:
- `trickle(fn, opts?)` / `trickle(name, fn, opts?)` -- wrap a function
- `trickleHandler(fn, opts?)` -- wrap a Lambda handler (auto-flushes)
- `configure(opts)` -- set global options (`backendUrl`, `batchIntervalMs`, `enabled`, `environment`)
- `flush()` -- flush pending observations
- `instrumentExpress`, `trickleMiddleware` -- Express instrumentation
- `instrumentFastify`, `tricklePlugin` -- Fastify instrumentation
- `instrumentKoa`, `instrumentKoaRouter` -- Koa instrumentation
- `instrumentHono`, `trickleHonoMiddleware` -- Hono instrumentation

`GlobalOpts`:
- `backendUrl` (default: `http://localhost:4888`)
- `batchIntervalMs` (default: 2000)
- `enabled` (default: true)
- `environment` (auto-detected if not set)

#### `types.ts`

TypeNode definition:

```typescript
type TypeNode =
  | { kind: "primitive"; name: "string" | "number" | "boolean" | ... }
  | { kind: "array"; element: TypeNode }
  | { kind: "object"; properties: Record<string, TypeNode> }
  | { kind: "union"; members: TypeNode[] }
  | { kind: "function"; params: TypeNode[]; returnType: TypeNode }
  | { kind: "promise"; resolved: TypeNode }
  | { kind: "map"; key: TypeNode; value: TypeNode }
  | { kind: "set"; element: TypeNode }
  | { kind: "tuple"; elements: TypeNode[] }
  | { kind: "unknown" };
```

#### `type-inference.ts`

Infers TypeNode from runtime JavaScript values. Handles all JS types including Promise, Map, Set, typed arrays, Buffer, etc.

#### `type-hash.ts`

Deterministic hashing of TypeNode structures for deduplication.

#### `transport.ts`

Batched HTTP transport to the backend. Sends to `POST /api/ingest/batch` with `{ payloads: batch }`.

#### `cache.ts`

Caching layer to avoid re-sending duplicate type observations.

#### `wrap.ts`

Core function wrapping logic. `wrapFunction(fn, opts)` returns a new function that captures args/return types, infers TypeNodes, hashes them, and sends to the backend.

#### `observe.ts`

Universal observation: `observe(obj)` wraps all functions on an object, `observeFn(fn)` wraps a single function.

#### `trace-var.ts` [CORE]

Variable-level tracing -- captures runtime type and sample value of variable assignments.

Injected by the `Module._compile` source transform. After each `const/let/var x = expr;`, the transform inserts:
```javascript
__trickle_tv(x, 'x', 42, 'my-module', '/path/to/file.ts');
```

Features:
- Infers TypeNode from runtime value
- Captures sanitized sample value
- Appends to `.trickle/variables.jsonl`
- Caches by `(file:line:varName + typeHash)` to avoid duplicates
- Batched writes (buffer of 100, flush every 1000ms)
- Per-line sample count limit (5) to avoid loop spam
- Auto-detects Lambda environment (uses `/tmp/.trickle`)

#### `call-trace.ts`

Records function call graphs for dependency analysis.

#### `env-detect.ts`

Detects runtime environment (development, production, test, lambda, etc.).

#### `request-context.ts`

Request-scoped context for correlating observations.

#### `proxy-tracker.ts`

Tracks proxy object access patterns.

### Framework Instrumentation

#### `express.ts`

Express.js auto-instrumentation via monkey-patching.

- `instrumentExpress(app)` -- patches `app.METHOD()` to wrap route handlers
- `trickleMiddleware` -- standalone Express middleware
- Generates route names like `GET /api/users` converted to PascalCase (`GetApiUsers`)

#### `fastify.ts`

Fastify instrumentation via plugin.

- `instrumentFastify(fastify)` -- registers a Fastify plugin
- `tricklePlugin` -- standalone Fastify plugin

#### `koa.ts`

Koa instrumentation.

- `instrumentKoa(app)` -- patches Koa middleware
- `instrumentKoaRouter(router)` -- patches Koa Router

#### `hono.ts`

Hono framework instrumentation.

- `instrumentHono(app)` -- patches Hono routes
- `trickleHonoMiddleware` -- standalone Hono middleware

#### `lambda.ts`

AWS Lambda handler wrapper with auto-flush.

### Observers

#### `llm-observer.ts`

Patches LLM client libraries (OpenAI, Anthropic) to capture API calls. Writes to `.trickle/llm.jsonl`.

#### `db-observer.ts`

Patches database drivers (better-sqlite3, pg, mysql2, mongoose, prisma, knex, drizzle, redis) to capture queries. Writes to `.trickle/queries.jsonl`.

#### `fetch-observer.ts`

Patches global `fetch` to capture HTTP requests/responses.

#### `log-observer.ts`

Captures `console.log`/`console.error` output. Writes to `.trickle/console.jsonl`.

#### `mcp-observer.ts`

Patches MCP SDK client/server to capture tool calls.

#### `ws-observer.ts`

Patches WebSocket libraries to capture messages.

### Build Integrations

#### `vite-plugin.ts`

Vite plugin for React component instrumentation.

- Transforms JSX/TSX files to track component renders, hook invocations, and state updates
- Emits `react_render`, `react_hook`, and `react_state` records
- VSCode shows render counts and state values as inlay hints

#### `next-plugin.ts`

Next.js plugin for automatic instrumentation.

- Configures Next.js webpack to use trickle's loader
- Handles both app router and pages router

#### `next-loader.ts`

Webpack loader for Next.js that transforms source files.

#### `metro-transformer.ts`

React Native Metro bundler transformer for mobile instrumentation.

### Auto Registration

#### `register.ts`

`node -r trickle/register` -- patches `Module._load` to wrap all user module exports.

#### `observe-register.ts`

`node -r trickle/observe` -- patches `Module._compile` to transform source code, inserting `__trickle_tv()` variable trace calls after declarations and wrapping function exports. This is the deep observation mode used by `trickle run`.

#### `auto-register.ts`

Auto-registers instrumentation based on detected dependencies.

#### `auto-codegen.ts`

Auto-generates type stubs from observations.

---

## VSCode Extension

**Package**: `trickle-vscode` (in `packages/vscode-extension`)

### Overview

The extension activates when it finds a `.trickle/variables.jsonl` file in the workspace or when a Jupyter notebook is opened. It reads observation data from JSONL files and renders it in the editor.

### Activation

```json
"activationEvents": [
  "workspaceContains:**/.trickle/variables.jsonl",
  "onNotebook:jupyter-notebook"
]
```

### Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `trickle.enabled` | boolean | `true` | Enable trickle variable hover |
| `trickle.showSampleValues` | boolean | `true` | Show sample values in hover |
| `trickle.inlineHints` | boolean | `true` | Show inline type hints after variable declarations |
| `trickle.inlineHintMode` | enum | `"auto"` | What to display: `auto`, `sample`, `type`, or `error` |

**Inline hint modes:**
- `auto` -- sample values for primitives, types for complex structures
- `sample` -- always show sample/value data inline when available
- `type` -- always show the runtime type inline
- `error` -- show variable values captured at the last error (post-mortem debug view)

### Commands

| Command | Title |
|---------|-------|
| `trickle.refreshVariables` | Trickle: Refresh Variable Data |
| `trickle.clearVariables` | Trickle: Clear Variable Data |
| `trickle.toggleInlineHints` | Trickle: Toggle Inline Hints |
| `trickle.cycleInlineHintMode` | Trickle: Cycle Inline Hint Mode |
| `trickle.showCostReport` | Opens terminal with `trickle cost-report` |
| `trickle.showEval` | Opens terminal with `trickle eval` |
| `trickle.showSecurity` | Opens terminal with `trickle security` |

### Providers

All providers are implemented in `packages/vscode-extension/src/extension.ts`.

#### `TrickleHoverProvider` [CORE]

Registered for: TypeScript, JavaScript, Python, Jupyter notebook cells.

When hovering over a variable name:
1. Looks up the variable in the observation index by file path and line number
2. Falls back to searching all lines in the file for that variable name
3. Handles attribute vars (`self.weight` matches when hovering on `weight`)
4. Shows return value info when hovering over `return` keyword
5. Builds a Markdown tooltip with:
   - Runtime type (e.g., `Tensor[4, 8, 32] float32`)
   - Tensor statistics (mean, std, min, max, norm, grad norm)
   - GPU/CPU memory usage
   - Sample value (JSON formatted)
   - Value history (previous samples)
   - Call flow information
   - Gradient flow data (vanishing/exploding warnings)
   - Dimension labels

#### `TrickleInlayHintsProvider` [CORE]

Provides inline type hints after variable declarations.

Behavior depends on `inlineHintMode`:
- **Normal mode**: Shows type annotations inline after variable names on assignment/declaration lines
- **Error mode**: Shows error snapshot values -- the state of variables at crash time

Handles Python patterns:
- Bare assignment: `x = ...` shows `: int` after `x`
- For-loop: `for x in ...` shows type of `x`
- With-as: `with ... as x:` shows type of `x`
- Function params: `def fn(x, y):` shows types of `x` and `y`
- Attribute assignment: `self.x = ...` shows type
- Skips already-annotated variables (`x: int = ...`)

Also renders ML-specific inlay hints:
- Gradient flow at `loss.backward()` lines
- LR schedule at `scheduler.step()` lines
- Checkpoint info at `torch.save()` lines
- Optimizer stats at `optimizer.step()` lines
- DataLoader batch shapes at `for batch in loader:` lines
- Training throughput and ETA
- Activation statistics at module forward call sites
- Loss probe patterns at `loss.backward()` lines
- Attention statistics at `F.softmax()` lines
- React render counts, hook invocations, state updates (from Vite plugin)
- Training progress from `trickle.progress()`
- Type drift indicators (variable type changed since last run)

#### `TrickleCompletionProvider` [CORE]

Provides runtime-type-aware autocomplete after `.` on variables with known types.

- Matches `varName.` pattern at cursor position
- Looks up the variable's observed type in the current scope
- Provides property and method completions from:
  - Known type members (Tensor, ndarray, DataFrame, etc.)
  - Observed object properties from runtime data

#### `TrickleSemanticTokensProvider` [CORE]

Provides semantic syntax highlighting for properties and methods based on runtime type data.

- Identifies `varName.attr` patterns in source code
- Colors attributes as properties or methods based on known type information

#### `TrickleCostCodeLensProvider`

Shows CodeLens annotations at the top of files:
- LLM cost summary: call count, total cost, tokens, models, errors (from `.trickle/llm.jsonl`)
- Agent eval summary: agent runs, tool calls, errors (from `.trickle/agents.jsonl`)
- Security alerts: critical/warning counts (from `.trickle/alerts.jsonl`)

### File Watching

The extension watches multiple JSONL files across all workspace folders using glob patterns:

- `**/.trickle/variables.jsonl` -- variable observations (debounced 300ms reload)
- `**/.trickle/errors.jsonl` -- error records (debounced 300ms reload)
- `**/.trickle/alerts.jsonl` -- security/agent alerts

It also uses `findAllTrickleDirs()` to discover all `.trickle` directories in the workspace tree (skipping `node_modules`, `.git`, `__pycache__`, `.venv`, `venv`, `dist`, `build`).

### Source Edit Tracking

When source files are edited:
- Hints on edited lines are invalidated (removed)
- Hints on lines below the edit are shifted by the line delta
- The observation index is updated in-place without requiring a full reload

### Data Indexes

The extension maintains several in-memory indexes, all populated from `variables.jsonl`:

| Index | Key | Record Kind | Description |
|-------|-----|-------------|-------------|
| `varIndex` | filePath -> lineNo -> obs[] | `variable` | Variable observations |
| `notebookCellIndex` | notebookPath#cell_N -> lineNo -> obs[] | `variable` | Notebook cell observations |
| `errorSnapshotIndex` | filePath -> lineNo -> obs[] | `error_snapshot` | Error-time variable snapshots |
| `dimLabelIndex` | filePath -> varName -> record | `dim_labels` | Dimension labels for tensors |
| `gradientIndex` | filePath -> lineNo -> record | `gradient` | Gradient flow records |
| `lrScheduleIndex` | filePath -> lineNo -> record | `lr_schedule` | Learning rate schedule |
| `checkpointIndex` | filePath -> lineNo -> record[] | `checkpoint` | Model checkpoint saves |
| `optimizerIndex` | filePath -> lineNo -> record | `optimizer_step` | Optimizer step stats |
| `dataloaderIndex` | filePath -> lineNo -> record | `dataloader_batch` | Batch shapes |
| `throughputIndex` | filePath -> lineNo -> record | `training_throughput` | Training throughput |
| `activationIndex` | filePath -> lineNo -> record[] | `activation_stats` | Activation statistics |
| `lossProbeIndex` | filePath -> lineNo -> record | `loss_probe` | Loss pattern detection |
| `attentionIndex` | filePath -> lineNo -> record | `attention_stats` | Attention weight stats |
| `reactRenderIndex` | filePath -> lineNo -> record | `react_render` | React component renders |
| `reactHookIndex` | filePath -> lineNo -> record | `react_hook` | React hook invocations |
| `reactStateIndex` | filePath -> lineNo -> record | `react_state` | React useState updates |
| `crashVarIndex` | filePath -> lineNo -> var[] | (from errors.jsonl) | Local vars at crash frame |
| `latestProgress` | (global) | `progress` | Latest training progress |

### Type Drift Detection

The extension tracks type hashes across sessions:
- On load, compares current type hashes against previous ones stored in `.trickle/type_history.json`
- Variables whose type changed are highlighted with a drift indicator
- Persists current hashes to `.trickle/type_history.json` for cross-session detection

### Status Bar

Two status bar items:
1. **Variable count**: `Trickle: 42 vars` (or training progress when active: `Training: epoch 3 | loss 0.342 | lr 2.34e-04`)
2. **Hint mode**: Shows current mode icon and name, click to cycle

---

## Backend

**Package**: `trickle-backend` (in `packages/backend`)

Express.js server with SQLite (better-sqlite3). Default port: 4888. Database at `~/.trickle/trickle.db`.

### Server Configuration

- **CORS**: All origins in dev, configurable via `TRICKLE_CORS_ORIGINS` env var
- **Body limit**: 10MB JSON
- **Rate limiting**: 300 req/min per IP in production (configurable via `TRICKLE_RATE_LIMIT`)
- **Database path**: `TRICKLE_DB_PATH` env var or `~/.trickle/trickle.db`
- **WAL mode**: SQLite journal mode set to WAL for concurrent reads
- **Foreign keys**: Enabled

### Database Schema

Three tables defined in `packages/backend/src/db/migrations.ts`:

#### `functions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `function_name` | TEXT NOT NULL | Function or route name |
| `module` | TEXT NOT NULL | Module/file name |
| `environment` | TEXT NOT NULL | Environment (development, production, etc.) |
| `language` | TEXT NOT NULL | `"js"` or `"python"` |
| `first_seen_at` | TEXT | ISO datetime |
| `last_seen_at` | TEXT | ISO datetime |

Unique constraint: `(function_name, module, language)`

#### `type_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `function_id` | INTEGER FK | References `functions(id)` |
| `type_hash` | TEXT NOT NULL | Deterministic hash of the type |
| `args_type` | TEXT NOT NULL | JSON TypeNode for arguments |
| `return_type` | TEXT NOT NULL | JSON TypeNode for return value |
| `variables_type` | TEXT | JSON TypeNode for local variables |
| `sample_input` | TEXT | JSON sample input value |
| `sample_output` | TEXT | JSON sample output value |
| `env` | TEXT NOT NULL | Environment |
| `observed_at` | TEXT | ISO datetime |

Unique constraint: `(function_id, type_hash, env)`

#### `errors`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `function_id` | INTEGER FK | References `functions(id)` |
| `error_type` | TEXT NOT NULL | Exception class name |
| `error_message` | TEXT NOT NULL | Error message |
| `stack_trace` | TEXT | Full stack trace |
| `args_type` | TEXT | JSON TypeNode for args at error time |
| `return_type` | TEXT | JSON TypeNode for return type |
| `variables_type` | TEXT | JSON TypeNode for local variables |
| `args_snapshot` | TEXT | JSON snapshot of actual argument values |
| `type_hash` | TEXT | Type hash at error time |
| `env` | TEXT NOT NULL | Environment |
| `occurred_at` | TEXT | ISO datetime |

### Routes

#### `POST /api/ingest` [CORE]

Single payload ingest.

Request body (`IngestPayload`):
```json
{
  "functionName": "getUser",
  "module": "api/users",
  "language": "js",
  "environment": "development",
  "typeHash": "abc123",
  "argsType": { "kind": "object", "properties": { "id": { "kind": "primitive", "name": "number" } } },
  "returnType": { "kind": "object", "properties": { "name": { "kind": "primitive", "name": "string" } } },
  "sampleInput": { "id": 42 },
  "sampleOutput": { "name": "Alice" },
  "error": {
    "type": "TypeError",
    "message": "Cannot read property 'name' of undefined",
    "stackTrace": "...",
    "argsSnapshot": { "id": null }
  }
}
```

Response: `{ ok: true, functionId, isNewType, errorId }`

#### `POST /api/ingest/batch` [CORE]

Batch ingest. Request body: `{ payloads: IngestPayload[] }`. Wrapped in a SQLite transaction.

Response: `{ ok: true, results: [...] }`

#### `GET /api/functions` [ARCHIVED]

List observed functions. Supports filtering by env, language, search query.

#### `GET /api/types` [ARCHIVED]

Show type snapshots for a function.

#### `GET /api/errors` [ARCHIVED]

List errors with filtering.

#### `GET /api/tail` [ARCHIVED]

SSE (Server-Sent Events) endpoint for live streaming of new type and error events.

#### `GET /api/codegen` [ARCHIVED]

Generate TypeScript/Python type definitions from observed types.

#### `GET /api/mock-config` [ARCHIVED]

Get mock server configuration from observed routes and sample data.

#### `GET /api/diff` [ARCHIVED]

Show type drift between time periods or environments.

#### `GET /dashboard` [ARCHIVED]

Serve the web dashboard HTML.

#### `GET /api/coverage` [ARCHIVED]

Type observation health report.

#### `GET /api/audit` [ARCHIVED]

API type quality analysis.

#### `GET /api/search` [ARCHIVED]

Search across all observed types.

#### `/api/v1` (Cloud) [ARCHIVED]

Cloud sync endpoints for team collaboration (behind rate limiting).

#### `GET /api/health`

Health check endpoint. Returns: `{ ok: true, timestamp, version }`

### Services

#### `sse-broker.ts`

Server-Sent Events broker. Broadcasts events to connected clients for live tailing:
- `type:new` -- emitted when a new type hash is observed
- `error:new` -- emitted when a new error is recorded

#### `type-differ.ts`

Computes structural diffs between TypeNode trees. Returns changes as `{ kind: "added" | "removed" | "changed", path, from?, to? }`.

#### `type-generator.ts`

Generates TypeScript declarations and Python type stubs from TypeNode trees.

### Queries (`db/queries.ts`)

- `upsertFunction(db, params)` -- INSERT OR IGNORE + UPDATE last_seen_at
- `findSnapshotByHash(db, functionId, typeHash, env)` -- lookup by unique constraint
- `insertSnapshot(db, params)` -- insert new type snapshot
- `insertError(db, params)` -- insert error record

---

## Local File Format

All local data is stored in the `.trickle/` directory at the project root:

| File | Format | Description |
|------|--------|-------------|
| `variables.jsonl` | Newline-delimited JSON | Variable observations, ML metrics, training progress |
| `errors.jsonl` | Newline-delimited JSON | Runtime errors with stack traces and local vars |
| `observations.jsonl` | Newline-delimited JSON | Function-level type observations |
| `llm.jsonl` | Newline-delimited JSON | LLM API call records |
| `queries.jsonl` | Newline-delimited JSON | Database query records |
| `agents.jsonl` | Newline-delimited JSON | Agent framework events |
| `memory.jsonl` | Newline-delimited JSON | Agent memory operations |
| `console.jsonl` | Newline-delimited JSON | Captured stdout/stderr |
| `alerts.jsonl` | Newline-delimited JSON | Security and agent alerts |
| `type_history.json` | JSON object | Type hashes for drift detection |

### `variables.jsonl` Record Kinds

Each line in `variables.jsonl` is a JSON object with a `kind` field:

| Kind | Source | Description |
|------|--------|-------------|
| `variable` | trace-var / notebook | Variable assignment observation |
| `error_snapshot` | error context | Variable values captured at crash time |
| `gradient` | `_backward_hook` | Per-layer gradient norms after backward() |
| `lr_schedule` | `_lr_scheduler_hook` | Learning rate after scheduler.step() |
| `checkpoint` | `_checkpoint_hook` | Model checkpoint save event |
| `optimizer_step` | `_optimizer_hook` | Optimizer step statistics |
| `dataloader_batch` | `_dataloader_hook` | Batch tensor shapes from DataLoader |
| `training_throughput` | `_dataloader_hook` | Samples/sec, batches/sec, ETA |
| `activation_stats` | `_activation_hook` | Activation statistics per module |
| `loss_probe` | `_loss_probe_hook` | Loss value and pattern detection |
| `attention_stats` | `_attention_hook` | Attention weight statistics |
| `dim_labels` | notebook | Dimension labels for tensors |
| `progress` | `trickle.progress()` | Training metrics (epoch, loss, lr, etc.) |
| `react_render` | Vite plugin | React component render tracking |
| `react_hook` | Vite plugin | React hook invocation tracking |
| `react_state` | Vite plugin | React useState update tracking |
