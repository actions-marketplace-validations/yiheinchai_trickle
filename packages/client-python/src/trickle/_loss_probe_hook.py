"""Patch torch.Tensor.backward to probe loss patterns and emit records.

When `trickle.auto` is active, this module patches `torch.Tensor.backward()`
so that each time backward is called on a scalar tensor (the loss), the value
is captured and analysed.  After enough steps, the pattern is detected and
shown as an inlay hint on the `.backward()` call line in VSCode:

    loss.backward()  # ↘ 2.34 avg=2.41 Δ=-0.03/step
    loss.backward()  # ⚠ NaN [diverging]
    loss.backward()  # — 1.23 ±0.01 [plateau — try raising LR]
    loss.backward()  # 〰 2.34 ±0.45 [oscillating — try lowering LR]
    loss.backward()  # ↗ 3.12 [increasing — check LR/data]

Patterns detected (rolling window of 20 steps):
  - plateau:     coefficient of variation < 1%
  - diverging:   NaN / inf / sustained increase
  - oscillating: >60% of consecutive diffs change sign
  - increasing:  positive linear trend
  - decreasing:  normal healthy training

Rate-limited to every TRICKLE_LOSS_EVERY (default 5) backward calls per
(file, line) call site.
"""
from __future__ import annotations

import inspect
import json
import math
import os
import time
from typing import Any, Dict, List, Optional

_installed = False
_EVERY = int(os.environ.get("TRICKLE_LOSS_EVERY", "5"))
_WINDOW = 20  # rolling window for pattern detection

# Per call-site state
# key: "file:line" -> {"values": [...], "step": int}
_state: Dict[str, Dict[str, Any]] = {}


def _get_vars_file() -> str:
    local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
    os.makedirs(local_dir, exist_ok=True)
    return os.path.join(local_dir, "variables.jsonl")


def _find_user_frame() -> Optional[Any]:
    """Walk the call stack to find the user's .backward() call site."""
    frame = inspect.currentframe()
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


def _detect_pattern(values: List[float]) -> str:
    """Classify the loss trajectory from a list of recent scalar values."""
    if len(values) < 3:
        return "unknown"

    # NaN / inf check
    if any(not math.isfinite(v) for v in values[-3:]):
        return "diverging"

    n = len(values)
    mean_v = sum(values) / n
    if mean_v == 0:
        return "unknown"

    # Variance / std
    var = sum((v - mean_v) ** 2 for v in values) / n
    std_v = math.sqrt(var)
    cv = std_v / abs(mean_v)  # coefficient of variation

    # Plateau: very low relative variance
    if cv < 0.005:
        return "plateau"

    # Compute consecutive differences
    diffs = [values[i + 1] - values[i] for i in range(n - 1)]

    # Oscillation: high sign-change rate
    sign_changes = sum(
        1 for i in range(len(diffs) - 1)
        if diffs[i] * diffs[i + 1] < 0
    )
    if sign_changes / max(len(diffs) - 1, 1) > 0.55:
        return "oscillating"

    # Linear trend via simple least squares
    xs = list(range(n))
    x_mean = (n - 1) / 2.0
    slope_num = sum((xs[i] - x_mean) * (values[i] - mean_v) for i in range(n))
    slope_den = sum((xs[i] - x_mean) ** 2 for i in range(n))
    slope = slope_num / slope_den if slope_den else 0.0

    if slope > 0.001 * abs(mean_v):
        return "increasing"
    if slope < -0.0001 * abs(mean_v):
        return "decreasing"

    return "stable"


_PATTERN_ICON: Dict[str, str] = {
    "decreasing": "↘",
    "increasing": "↗",
    "plateau": "—",
    "oscillating": "〰",
    "diverging": "⚠",
    "stable": "→",
    "unknown": "?",
}

_PATTERN_TIP: Dict[str, str] = {
    "plateau": "try raising LR or check for gradient vanishing",
    "oscillating": "try lowering LR or use gradient clipping",
    "increasing": "check LR, data, or possible bug",
    "diverging": "check for NaN/Inf — lower LR or add gradient clipping",
    "decreasing": "training looks healthy",
    "stable": "loss is stable",
    "unknown": "",
}


def _patched_backward(self: Any, gradient: Any = None,
                      retain_graph: Any = None,
                      create_graph: bool = False,
                      inputs: Any = None) -> None:
    """Wrapper around Tensor.backward() that probes loss patterns."""
    # Only probe scalar tensors (loss values)
    try:
        numel = 1
        for d in self.shape:
            numel *= d
        is_scalar = (numel == 1)
    except Exception:
        is_scalar = False

    if is_scalar:
        try:
            frame = _find_user_frame()
            if frame is not None:
                filename = frame.f_code.co_filename
                line = frame.f_lineno
                key = f"{filename}:{line}"

                state = _state.setdefault(key, {"values": [], "step": 0})
                state["step"] += 1

                loss_val = float(self.detach().item())
                state["values"].append(loss_val)
                if len(state["values"]) > _WINDOW:
                    state["values"].pop(0)

                if state["step"] % _EVERY == 0 and len(state["values"]) >= 3:
                    vals = state["values"]
                    pattern = _detect_pattern(vals)
                    recent = vals[-min(5, len(vals)):]
                    avg = sum(vals) / len(vals)

                    # Per-step delta: slope over recent window
                    if len(vals) >= 2:
                        delta = (vals[-1] - vals[0]) / (len(vals) - 1)
                    else:
                        delta = 0.0

                    record: Dict[str, Any] = {
                        "kind": "loss_probe",
                        "file": filename,
                        "line": line,
                        "loss": round(loss_val, 6),
                        "loss_avg": round(avg, 6),
                        "loss_delta": round(delta, 6),
                        "loss_std": round(
                            math.sqrt(sum((v - avg) ** 2 for v in vals) / len(vals)),
                            6,
                        ),
                        "pattern": pattern,
                        "step": state["step"],
                        "timestamp": time.time(),
                    }
                    with open(_get_vars_file(), "a") as f:
                        f.write(json.dumps(record) + "\n")
        except Exception:
            pass

    # Call original backward
    _orig_backward(self, gradient=gradient, retain_graph=retain_graph,
                   create_graph=create_graph, inputs=inputs)


_orig_backward: Any = None


def install() -> None:
    """Patch torch.Tensor.backward to probe loss patterns."""
    global _installed, _orig_backward
    if _installed:
        return
    _installed = True

    try:
        import torch
        _orig_backward = torch.Tensor.backward
        torch.Tensor.backward = _patched_backward  # type: ignore[method-assign]
    except Exception:
        pass
