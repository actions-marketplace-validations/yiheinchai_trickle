"""Patch DataLoader iterators to emit batch shape and throughput records.

When `trickle.auto` is active, this module patches
torch.utils.data.DataLoader's internal iterator classes so that each
time a batch is yielded by a ``for`` loop, the batch tensor shapes are
recorded.  The VSCode extension shows them as inlay hints on the ``for``
line, e.g.:

    for batch in train_loader:   ⬛ [32,3,224,224] float32, [32] int64

Throughput metrics are also tracked and shown as a separate inlay hint:

    for batch in train_loader:   ⚡ 1.23k smp/s | 38.5 bat/s | ETA 0:12

Handles:
  - Tuple/list batches  → (inputs[B,C,H,W], labels[B])
  - Dict batches        → {input_ids[B,T], attention_mask[B,T]}  (HuggingFace)
  - Single-tensor batch → [B,C,H,W]

Emits at most ``TRICKLE_DL_BATCHES`` (default 3) shape records per for-loop
line so the file doesn't grow unbounded during long training runs.
Throughput is emitted every ``TRICKLE_THROUGHPUT_EVERY`` (default 10) batches.
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

_installed = False
# key: "file:line" → number of batches emitted
_batch_counter: Dict[str, int] = {}

# How many batches to emit per loop location before rate-limiting shape records
_MAX_BATCHES = int(os.environ.get("TRICKLE_DL_BATCHES", "3"))
# How often to emit throughput records (every N batches at a given call site)
_THROUGHPUT_EVERY = int(os.environ.get("TRICKLE_THROUGHPUT_EVERY", "10"))
# Rolling window size for throughput averaging
_THROUGHPUT_WINDOW = 20

# Per call-site throughput state:
# key: "file:line" → dict with batch timing info
_throughput_state: Dict[str, Dict[str, Any]] = {}


# ── Shape helpers ──────────────────────────────────────────────────────────

def _shape_entry(item: Any, index: Optional[int] = None, key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Return a JSON-safe shape descriptor for a single tensor-like object."""
    if not hasattr(item, "shape"):
        return None
    try:
        shape = list(item.shape)
        dtype = str(getattr(item, "dtype", "unknown"))
        entry: Dict[str, Any] = {"shape": shape, "dtype": dtype}
        if index is not None:
            entry["index"] = index
        if key is not None:
            entry["key"] = key
        return entry
    except Exception:
        return None


def _extract_shapes(batch: Any) -> List[Dict[str, Any]]:
    """Recursively extract shape descriptors from a batch."""
    shapes: List[Dict[str, Any]] = []

    if isinstance(batch, dict):
        # HuggingFace / custom dict batches
        for k, v in batch.items():
            entry = _shape_entry(v, key=str(k))
            if entry:
                shapes.append(entry)
    elif isinstance(batch, (tuple, list)):
        for i, item in enumerate(batch):
            if isinstance(item, dict):
                # Nested dict inside tuple (rare but happens)
                for k, v in item.items():
                    entry = _shape_entry(v, key=str(k))
                    if entry:
                        shapes.append(entry)
            else:
                entry = _shape_entry(item, index=i)
                if entry:
                    shapes.append(entry)
    else:
        # Single tensor
        entry = _shape_entry(batch)
        if entry:
            shapes.append(entry)

    return shapes


def _infer_batch_size(batch: Any) -> Optional[int]:
    """Infer the number of samples in a batch."""
    try:
        if isinstance(batch, dict):
            for v in batch.values():
                if hasattr(v, "shape") and len(v.shape) > 0:
                    return int(v.shape[0])
        elif isinstance(batch, (tuple, list)):
            for item in batch:
                if hasattr(item, "shape") and len(item.shape) > 0:
                    return int(item.shape[0])
        elif hasattr(batch, "shape") and len(batch.shape) > 0:
            return int(batch.shape[0])
    except Exception:
        pass
    return None


def _get_total_batches(iterator: Any) -> Optional[int]:
    """Try to get total number of batches from the DataLoader iterator."""
    try:
        # The batch sampler knows the total number of batches for this epoch
        sampler = getattr(iterator, "_index_sampler", None)
        if sampler is not None:
            return len(sampler)
    except Exception:
        pass
    try:
        # Fallback: _loader attribute (some custom iterators)
        loader = getattr(iterator, "_loader", None)
        if loader is not None:
            return len(loader)
    except Exception:
        pass
    return None


# ── Frame helpers ──────────────────────────────────────────────────────────

def _find_user_frame() -> Optional[Any]:
    """Walk the call stack to find the first frame that belongs to user code."""
    frame = sys._getframe(0)
    while frame is not None:
        fname = frame.f_code.co_filename
        if (fname
                and not fname.startswith("<")
                and os.path.isfile(fname)
                and "site-packages" not in fname
                and "/trickle/" not in fname
                and "\\trickle\\" not in fname):
            return frame
        frame = frame.f_back
    return None


# ── Output ─────────────────────────────────────────────────────────────────

def _get_vars_file() -> str:
    local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
    os.makedirs(local_dir, exist_ok=True)
    return os.path.join(local_dir, "variables.jsonl")


def _format_eta(seconds: float) -> str:
    """Format seconds as H:MM:SS or M:SS."""
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def _maybe_emit(iterator: Any, batch: Any) -> None:
    """Emit dataloader_batch and training_throughput records if we're in a user for loop."""
    try:
        now = time.time()
        frame = _find_user_frame()
        if frame is None:
            return

        filename = frame.f_code.co_filename
        line = frame.f_lineno
        key = f"{filename}:{line}"

        vars_file = _get_vars_file()

        # ── Shape record (rate-limited to _MAX_BATCHES per call site) ──
        count = _batch_counter.get(key, 0)
        if count < _MAX_BATCHES:
            _batch_counter[key] = count + 1
            shapes = _extract_shapes(batch)
            if shapes:
                record: Dict[str, Any] = {
                    "kind": "dataloader_batch",
                    "file": filename,
                    "line": line,
                    "shapes": shapes,
                    "batch_num": count + 1,
                    "timestamp": now,
                }
                with open(vars_file, "a") as f:
                    f.write(json.dumps(record) + "\n")

        # ── Throughput tracking ──
        state = _throughput_state.get(key)
        if state is None:
            # First batch — initialise state
            batch_size = _infer_batch_size(batch)
            total_batches = _get_total_batches(iterator)
            _throughput_state[key] = {
                "batch_count": 1,
                "last_yield_time": now,
                "durations": [],          # rolling window of inter-batch durations
                "batch_size": batch_size,
                "total_batches": total_batches,
            }
            return  # Need ≥ 2 batches for timing

        # Update timing
        elapsed = now - state["last_yield_time"]
        state["last_yield_time"] = now
        state["batch_count"] += 1

        durations: List[float] = state["durations"]
        durations.append(elapsed)
        if len(durations) > _THROUGHPUT_WINDOW:
            durations.pop(0)

        # Refresh total_batches lazily (only on first few calls, cheap)
        if state["total_batches"] is None and state["batch_count"] <= 5:
            state["total_batches"] = _get_total_batches(iterator)

        # Emit throughput record every _THROUGHPUT_EVERY batches
        if state["batch_count"] % _THROUGHPUT_EVERY != 0:
            return

        avg_duration = sum(durations) / len(durations)
        batches_per_sec = 1.0 / avg_duration if avg_duration > 0 else 0.0
        batch_size = state["batch_size"] or 1
        samples_per_sec = batches_per_sec * batch_size

        throughput: Dict[str, Any] = {
            "kind": "training_throughput",
            "file": filename,
            "line": line,
            "samples_per_sec": round(samples_per_sec, 2),
            "batches_per_sec": round(batches_per_sec, 4),
            "batch_size": batch_size,
            "batch_count": state["batch_count"],
            "timestamp": now,
        }

        total = state["total_batches"]
        if total is not None and total > 0:
            remaining = total - state["batch_count"]
            throughput["total_batches"] = total
            if remaining > 0 and batches_per_sec > 0:
                throughput["eta_seconds"] = round(remaining / batches_per_sec, 1)

        with open(vars_file, "a") as f:
            f.write(json.dumps(throughput) + "\n")

    except Exception:
        pass


# ── Patching ───────────────────────────────────────────────────────────────

def _patch_iter_class(cls: Any) -> None:
    """Wrap cls.__next__ to call _maybe_emit on each yielded batch."""
    orig_next = cls.__next__

    def patched_next(self: Any) -> Any:  # type: ignore[misc]
        batch = orig_next(self)
        try:
            _maybe_emit(self, batch)
        except Exception:
            pass
        return batch

    cls.__next__ = patched_next


def install() -> None:
    """Patch DataLoader iterator classes to emit batch shape records."""
    global _installed
    if _installed:
        return
    _installed = True

    try:
        import torch.utils.data.dataloader as _dl_mod

        for cls_name in ("_SingleProcessDataLoaderIter", "_MultiProcessingDataLoaderIter"):
            cls = getattr(_dl_mod, cls_name, None)
            if cls is not None:
                _patch_iter_class(cls)
    except ImportError:
        pass
    except Exception:
        pass
