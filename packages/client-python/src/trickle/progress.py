"""trickle.progress — emit training progress records for VSCode status bar display."""
from __future__ import annotations

import inspect
import json
import os
import time
from typing import Any

_progress_counter: dict = {}   # call-site key -> call count
_vars_file: str | None = None  # path to .trickle/variables.jsonl, resolved lazily


def progress(every: int = 1, **metrics: Any) -> None:
    """Emit a training progress record to .trickle/variables.jsonl.

    Call inside a training loop to show real-time metrics in the VSCode status bar.

    Args:
        every: Only write every N calls. Use ``every=10`` or ``every=100`` for
               tight inner loops to avoid file I/O on every batch.
        **metrics: Named metric values — any JSON-serialisable number, bool, or
                   string.  PyTorch/NumPy scalars are automatically unwrapped
                   with ``.item()``.

    Example::

        import trickle

        for epoch in range(10):
            for step, (x, y) in enumerate(loader):
                loss = criterion(model(x), y)
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()

                trickle.progress(
                    epoch=epoch,
                    step=step,
                    loss=loss.item(),
                    lr=scheduler.get_last_lr()[0],
                    every=10,
                )
    """
    global _vars_file

    # Locate call site for rate-limiting key
    frame = inspect.currentframe()
    caller = frame.f_back if frame else None
    file_path = caller.f_code.co_filename if caller else "<unknown>"
    line_no = caller.f_lineno if caller else 0

    # Rate limiting: only emit every N calls from this exact call site
    key = f"{file_path}:{line_no}"
    count = _progress_counter.get(key, 0) + 1
    _progress_counter[key] = count
    if count % every != 0:
        return

    # Resolve the output file on first use
    if _vars_file is None:
        local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
        os.makedirs(local_dir, exist_ok=True)
        _vars_file = os.path.join(local_dir, "variables.jsonl")

    # Serialize metrics — unwrap tensor scalars, round floats for readability
    serialized: dict = {}
    for k, v in metrics.items():
        try:
            if hasattr(v, "item"):
                v = v.item()
            if isinstance(v, bool):
                serialized[k] = v
            elif isinstance(v, float):
                serialized[k] = round(v, 6)
            elif isinstance(v, int):
                serialized[k] = v
            else:
                serialized[k] = str(v)
        except Exception:
            serialized[k] = str(v)

    record = {
        "kind": "progress",
        "file": file_path,
        "line": line_no,
        "metrics": serialized,
        "timestamp": time.time(),
        "call_count": count,
    }

    try:
        with open(_vars_file, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass
