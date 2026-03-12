# Trickle for ML Engineers

Stop adding `print(x.shape)` everywhere. Trickle automatically captures tensor shapes, dtypes, and devices at every variable assignment — then shows them inline in VSCode when you hover.

## Quick Start

```bash
# 1. Install the Python client
pip install -e packages/client-python

# 2. Install the VSCode extension
cd packages/vscode-extension && npm install && npm run compile
# Then: Cmd+Shift+P → "Install Extension from Location" → select packages/vscode-extension

# 3. Run your script
trickle run train.py
# or without the CLI:
TRICKLE_LOCAL=1 python -c "from trickle.observe_runner import main; main()" train.py
```

That's it. Open your script in VSCode — tensor shapes appear inline next to every variable.

## What You Get

### Inline tensor shapes in VSCode

After running your script, every variable gets an inline type hint:

```python
x = torch.randn(4, 8)          # → Tensor[4, 8] float32
w = torch.randn(16, 8)         # → Tensor[16, 8] float32
h = x @ w.T                    # → Tensor[4, 16] float32
```

This works for:
- Simple assignments (`x = ...`)
- Tuple unpacking (`B, T, C = x.size()`)
- For-loop variables (`for i, (x, y) in enumerate(loader)`)
- Function parameters (`def forward(self, x, targets=None)`)
- Variables inside imported modules (your model code, not torch internals)

### Hover for full details

Hover over any variable to see its runtime type, shape, dtype, device, and a sample value.

### Automatic error context

When your code crashes with a shape mismatch, trickle prints the tensor shapes near the crash site:

```
────────────────────────────────────────────────────────
  trickle: tensor shapes near the error
────────────────────────────────────────────────────────
  train.py
    line   31  batch                Tensor[4, 8] float32
    line   32  w                    Tensor[16, 32] float32
    line   32  b                    Tensor[16] float32
    line   27  x                    Tensor[4, 8] float32 ◄ error
    line   27  weight               Tensor[16, 32] float32
────────────────────────────────────────────────────────
```

No more guessing which tensor had the wrong shape.

### CLI inspection

```bash
# Show all captured variables
trickle vars

# Show only tensors
trickle vars --tensors

# Filter by file
trickle vars --file model.py
```

## How It Works

Trickle uses AST transformation — it rewrites your Python source at import time to insert lightweight tracing calls after every variable assignment. These calls capture the type, shape, dtype, and device of each value and write them to `.trickle/variables.jsonl`.

- **Entry file**: Transformed before execution via `_entry_transform.py`
- **Imported modules**: Transformed at import time via a `sys.meta_path` hook
- **Skipped**: stdlib, site-packages, torch/numpy/pandas internals (only your code is traced)
- **Deduplication**: Same shape at the same line is only recorded once (loops don't explode the file)

## Usage with Real Models

### Training script

```bash
trickle run train.py
```

### Jupyter notebooks

```python
%load_ext trickle
# Now all cells are traced — shapes appear in VSCode's notebook editor
```

### pytest / unittest

```bash
trickle run pytest tests/
trickle run "python -m unittest test_model"
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TRICKLE_LOCAL` | `0` | Set to `1` for offline mode (no backend needed) |
| `TRICKLE_TRACE_VARS` | `1` | Set to `0` to disable variable tracing |
| `TRICKLE_OBSERVE_INCLUDE` | (all user code) | Comma-separated module patterns to trace |
| `TRICKLE_OBSERVE_EXCLUDE` | (none) | Comma-separated module patterns to skip |
| `TRICKLE_DEBUG` | `0` | Set to `1` for verbose debug output |

## Tested On

- Karpathy's [nanoGPT](https://github.com/karpathy/nanoGPT) — GPT-2 implementation (68 vars, 38 tensors in model.py)
- Karpathy's [makemore](https://github.com/karpathy/makemore) — Transformer character-level model (76 vars, 41 tensors)
