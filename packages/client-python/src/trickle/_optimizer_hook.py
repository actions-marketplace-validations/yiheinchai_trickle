"""Patch torch.optim optimizers to emit optimizer state records.

After each optimizer.step() call, computes and emits:
  - Total gradient norm across all parameter groups
  - Weight update magnitude (||Δθ|| = ||θ_new - θ_old||)
  - Per-group parameter statistics (norm, mean, std)

These appear as inlay hints on the optimizer.step() line in VSCode:

    optimizer.step()  ⚙ grad=0.342 | Δθ=0.0034 | σ=0.482

Visual warning when:
  - grad_norm > TRICKLE_OPT_EXPLODE_THRESH (default 10.0) → ⚡
  - grad_norm < TRICKLE_OPT_VANISH_THRESH  (default 1e-5)  → ↓

Rate-limited to every TRICKLE_OPT_EVERY steps (default 10) per call site.

Implementation note: each concrete optimizer class (SGD, Adam, AdamW, …)
overrides `step()`, so we must patch each subclass individually rather than
patching the base `Optimizer.step` only.  We also install a hook on
`__init_subclass__` so custom optimizer subclasses are patched automatically.
"""
from __future__ import annotations

import inspect
import json
import os
import time
from typing import Any, Dict, List, Optional

_installed = False
_step_counter: Dict[str, int] = {}
_vars_file: Optional[str] = None

_EXPLODE_THRESH = float(os.environ.get("TRICKLE_OPT_EXPLODE_THRESH", "10.0"))
_VANISH_THRESH = float(os.environ.get("TRICKLE_OPT_VANISH_THRESH", "1e-5"))
_TRICKLE_MARK = "_trickle_wrapped"


def _get_vars_file() -> str:
    global _vars_file
    if _vars_file is None:
        local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
        os.makedirs(local_dir, exist_ok=True)
        _vars_file = os.path.join(local_dir, "variables.jsonl")
    return _vars_file


def _compute_grad_norm(param_groups: List[Any]) -> float:
    """Compute total L2 gradient norm across all parameter groups."""
    total_sq = 0.0
    try:
        for group in param_groups:
            for p in group["params"]:
                if p is not None and getattr(p, "grad", None) is not None:
                    total_sq += float(p.grad.detach().float().norm(2)) ** 2
    except Exception:
        pass
    return total_sq ** 0.5


def _snapshot_params(param_groups: List[Any]) -> Optional[Any]:
    """Flatten all parameters into a single tensor for update-norm computation."""
    try:
        import torch
        parts: List[Any] = []
        for group in param_groups:
            for p in group["params"]:
                if p is not None:
                    parts.append(p.detach().float().flatten())
        return torch.cat(parts) if parts else None
    except Exception:
        return None


def _compute_update_norm(param_groups: List[Any], prev_flat: Optional[Any]) -> float:
    """Compute L2 norm of weight updates: ||θ_new - θ_old||."""
    if prev_flat is None:
        return 0.0
    try:
        import torch
        parts: List[Any] = []
        for group in param_groups:
            for p in group["params"]:
                if p is not None:
                    parts.append(p.detach().float().flatten())
        if not parts:
            return 0.0
        return float((torch.cat(parts) - prev_flat).norm(2))
    except Exception:
        return 0.0


def _compute_param_stats(param_groups: List[Any]) -> List[Dict[str, Any]]:
    """Compute parameter statistics per group."""
    stats: List[Dict[str, Any]] = []
    try:
        import torch
        for group in param_groups:
            parts: List[Any] = []
            n_params = 0
            for p in group["params"]:
                if p is not None:
                    parts.append(p.detach().float().flatten())
                    n_params += p.numel()
            if not parts:
                continue
            flat = torch.cat(parts)
            stats.append({
                "lr": round(float(group.get("lr", 0)), 8),
                "n_params": n_params,
                "param_norm": round(float(flat.norm(2)), 6),
                "param_mean": round(float(flat.mean()), 6),
                "param_std": round(float(flat.std()), 6),
            })
    except Exception:
        pass
    return stats


def _find_user_frame(frame: Any) -> Optional[Any]:
    """Walk up the call stack from frame to find the first user code frame.

    PyTorch wraps optimizer.step() with profile_hook_step() inside
    Optimizer.__init__, so there is an extra 'wrapper' frame between our
    _patched_step and the actual user call site.  We skip all frames that
    belong to site-packages or trickle internals.
    """
    f = frame.f_back  # skip _patched_step itself
    while f is not None:
        fname = f.f_code.co_filename
        if (fname
                and not fname.startswith("<")
                and os.path.isfile(fname)
                and "site-packages" not in fname
                and "/trickle/" not in fname
                and "\\trickle\\" not in fname):
            return f
        f = f.f_back
    return None


def _collect_context(frame: Any) -> Dict[str, Any]:
    _NAMES = frozenset({"epoch", "epochs", "step", "global_step", "iteration",
                        "loss", "train_loss", "batch_idx", "batch_num"})
    ctx: Dict[str, Any] = {}
    if frame is None:
        return ctx
    for name, val in frame.f_locals.items():
        if name not in _NAMES:
            continue
        try:
            if hasattr(val, "item"):
                val = val.item()
            if isinstance(val, bool):
                continue
            if isinstance(val, (int, float)):
                ctx[name] = round(val, 6) if isinstance(val, float) else val
        except Exception:
            pass
    return ctx


def _make_patched_step(orig_step: Any, cls_name: str) -> Any:
    """Return a wrapped step() that emits optimizer state records."""

    def _patched_step(self: Any, closure: Any = None) -> Any:
        every = int(os.environ.get("TRICKLE_OPT_EVERY", "10"))

        should_emit = False
        src_file = "<unknown>"
        line_no = 0
        count = 1
        caller = None

        try:
            frame = inspect.currentframe()
            caller = _find_user_frame(frame) if frame else None
            src_file = caller.f_code.co_filename if caller else "<unknown>"
            line_no = caller.f_lineno if caller else 0

            key = f"{src_file}:{line_no}"
            count = _step_counter.get(key, 0) + 1
            _step_counter[key] = count
            should_emit = (count % every == 0)
        except Exception:
            pass
        finally:
            try:
                del frame
            except Exception:
                pass

        grad_norm = 0.0
        prev_flat = None
        if should_emit:
            try:
                grad_norm = _compute_grad_norm(self.param_groups)
                prev_flat = _snapshot_params(self.param_groups)
            except Exception:
                pass

        result = orig_step(self, closure)

        if not should_emit:
            return result

        try:
            update_norm = _compute_update_norm(self.param_groups, prev_flat)
            param_stats = _compute_param_stats(self.param_groups)

            ctx = _collect_context(caller)
            if not ctx and caller and caller.f_back:
                ctx = _collect_context(caller.f_back)

            record: Dict[str, Any] = {
                "kind": "optimizer_step",
                "file": src_file,
                "line": line_no,
                "grad_norm": round(grad_norm, 6),
                "update_norm": round(update_norm, 6),
                "param_stats": param_stats,
                "step_num": count,
                "context": ctx,
                "optimizer_class": type(self).__name__,
                "exploding": grad_norm > _EXPLODE_THRESH,
                "vanishing": 0.0 < grad_norm < _VANISH_THRESH,
                "timestamp": time.time(),
            }

            try:
                with open(_get_vars_file(), "a") as f:
                    f.write(json.dumps(record) + "\n")
            except Exception:
                pass
        except Exception:
            pass

        return result

    _patched_step._trickle_wrapped = True
    return _patched_step


def _wrap_optimizer_class(cls: Any) -> None:
    """Wrap the step() method of an optimizer class if not already wrapped."""
    try:
        own_step = cls.__dict__.get("step")
        if own_step is None:
            return  # inherits step from parent — parent will handle it
        if getattr(own_step, _TRICKLE_MARK, False):
            return  # already wrapped
        cls.step = _make_patched_step(own_step, cls.__name__)
    except Exception:
        pass


def _wrap_all_subclasses(base_cls: Any) -> None:
    """Recursively wrap step() on all existing subclasses."""
    for subcls in base_cls.__subclasses__():
        _wrap_optimizer_class(subcls)
        _wrap_all_subclasses(subcls)


def install() -> None:
    """Patch all torch optimizer step() methods to emit state records."""
    global _installed
    if _installed:
        return
    _installed = True

    try:
        import torch.optim as _optim_mod
    except ImportError:
        return

    Optimizer = getattr(_optim_mod, "Optimizer", None)
    if Optimizer is None:
        return

    # Also wrap base class step() (for custom optimizers that don't override it)
    _wrap_optimizer_class(Optimizer)

    # Wrap all existing concrete optimizer subclasses
    _wrap_all_subclasses(Optimizer)

    # Hook __init_subclass__ so future custom optimizer subclasses are wrapped too
    orig_init_subclass = Optimizer.__dict__.get("__init_subclass__")

    @classmethod  # type: ignore[misc]
    def _patched_init_subclass(cls: Any, **kwargs: Any) -> None:
        if orig_init_subclass is not None:
            orig_init_subclass.__func__(cls, **kwargs)
        _wrap_optimizer_class(cls)

    try:
        Optimizer.__init_subclass__ = _patched_init_subclass
    except Exception:
        pass
