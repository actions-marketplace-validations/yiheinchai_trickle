"""Patch DataLoader iterators to emit batch shape records.

When `trickle.auto` is active, this module patches
torch.utils.data.DataLoader's internal iterator classes so that each
time a batch is yielded by a ``for`` loop, the batch tensor shapes are
recorded.  The VSCode extension shows them as inlay hints on the ``for``
line, e.g.:

    for batch in train_loader:   ⬛ [32,3,224,224] float32, [32] int64

Handles:
  - Tuple/list batches  → (inputs[B,C,H,W], labels[B])
  - Dict batches        → {input_ids[B,T], attention_mask[B,T]}  (HuggingFace)
  - Single-tensor batch → [B,C,H,W]

Emits at most ``TRICKLE_DL_BATCHES`` (default 3) records per for-loop
line so the file doesn't grow unbounded during long training runs.
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

_installed = False
# key: "file:line" → number of batches emitted
_batch_counter: Dict[str, int] = {}

# How many batches to emit per loop location before rate-limiting
_MAX_BATCHES = int(os.environ.get("TRICKLE_DL_BATCHES", "3"))


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


def _maybe_emit(batch: Any) -> None:
    """Emit a dataloader_batch record if we're in a user for loop."""
    try:
        frame = _find_user_frame()
        if frame is None:
            return

        filename = frame.f_code.co_filename
        line = frame.f_lineno
        key = f"{filename}:{line}"

        count = _batch_counter.get(key, 0)
        if count >= _MAX_BATCHES:
            return
        _batch_counter[key] = count + 1

        shapes = _extract_shapes(batch)
        if not shapes:
            return

        record: Dict[str, Any] = {
            "kind": "dataloader_batch",
            "file": filename,
            "line": line,
            "shapes": shapes,
            "batch_num": count + 1,
            "timestamp": time.time(),
        }

        vars_file = _get_vars_file()
        with open(vars_file, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


# ── Patching ───────────────────────────────────────────────────────────────

def _patch_iter_class(cls: Any) -> None:
    """Wrap cls.__next__ to call _maybe_emit on each yielded batch."""
    orig_next = cls.__next__

    def patched_next(self: Any) -> Any:  # type: ignore[misc]
        batch = orig_next(self)
        try:
            _maybe_emit(batch)
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
