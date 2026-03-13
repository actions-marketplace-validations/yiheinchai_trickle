"""Patch torch.Tensor.backward() to re-emit nn.Module gradient info.

After loss.backward(), model parameters have .grad populated. This hook
walks the caller's frame to find nn.Module variables and re-emits their
type info (now including gradient norms) to the JSONL trace file.

Also emits `kind: "gradient"` records with per-layer gradient norms so the
VSCode extension can show gradient flow inlay hints (vanishing/exploding alerts)
at the backward() call site.
"""

from __future__ import annotations

import inspect
import json
import os
import time
from typing import Any, Callable, Dict, List, Optional

_installed = False
_original_backward: Any = None

# Thresholds for vanishing / exploding gradient detection
_VANISHING_THRESHOLD = 1e-6
_EXPLODING_THRESHOLD = 100.0


def _collect_layer_norms(model: Any) -> List[Dict[str, Any]]:
    """Collect gradient norms grouped by top-level layer name.

    Returns list of dicts: {name, norm, vanishing, exploding}
    Grouped by first component of parameter path so Transformer blocks like
    'layers.0.attn.weight' and 'layers.0.ffn.weight' both map to 'layers.0'.
    """
    # Accumulate squared norms per layer group
    layer_sq: Dict[str, float] = {}
    layer_count: Dict[str, int] = {}

    for param_name, param in model.named_parameters():
        if param.grad is None:
            continue
        try:
            norm = float(param.grad.detach().norm().item())
        except Exception:
            continue

        # Group by first two components (e.g. "layers.0", "fc1", "embedding")
        parts = param_name.split(".")
        group = ".".join(parts[:2]) if len(parts) >= 2 else parts[0]

        if group not in layer_sq:
            layer_sq[group] = 0.0
            layer_count[group] = 0
        layer_sq[group] += norm * norm
        layer_count[group] += 1

    if not layer_sq:
        return []

    layers = []
    for group, sq in layer_sq.items():
        count = layer_count[group]
        combined_norm = (sq ** 0.5) / max(count, 1)
        layers.append({
            "name": group,
            "norm": round(combined_norm, 8),
            "vanishing": combined_norm < _VANISHING_THRESHOLD,
            "exploding": combined_norm > _EXPLODING_THRESHOLD,
        })

    # Sort by norm descending so most significant layers appear first
    layers.sort(key=lambda x: x["norm"], reverse=True)
    return layers


def install(trace_fn: Optional[Callable] = None, file_path: Optional[str] = None) -> None:
    """Patch torch.Tensor.backward() to re-emit model gradient info.

    Parameters
    ----------
    trace_fn:
        A function with signature (value, var_name, line_no) that emits
        a variable record. If None, emits directly to variables.jsonl.
    file_path:
        The source file path for the trace record. Used when trace_fn is None.
    """
    global _installed, _original_backward
    if _installed:
        return
    _installed = True

    try:
        import torch
        import torch.nn as nn
    except ImportError:
        return

    _original_backward = torch.Tensor.backward

    def _patched_backward(self: Any, *args: Any, **kwargs: Any) -> None:
        _original_backward(self, *args, **kwargs)

        # After backward, find nn.Module variables in the caller's frame
        try:
            frame = inspect.currentframe()
            if frame is None:
                return
            caller = frame.f_back
            if caller is None:
                return

            # Search locals and globals for nn.Module instances
            candidates = {}
            for name, val in caller.f_locals.items():
                if name.startswith("_"):
                    continue
                if isinstance(val, nn.Module):
                    candidates[name] = val

            if not candidates:
                # Try one more frame up (common when backward is in a helper)
                caller2 = caller.f_back
                if caller2 is not None:
                    for name, val in caller2.f_locals.items():
                        if name.startswith("_"):
                            continue
                        if isinstance(val, nn.Module):
                            candidates[name] = val

            if not candidates:
                return

            for var_name, model in candidates.items():
                # Only re-emit if the model actually has gradients
                has_grads = any(p.grad is not None for p in model.parameters())
                if not has_grads:
                    continue

                if trace_fn is not None:
                    # Use the provided trace function
                    line_no = caller.f_lineno
                    trace_fn(model, var_name, line_no)
                else:
                    # Emit variable record and gradient record directly to JSONL
                    _emit_direct(model, var_name, caller, file_path)
                    _emit_gradient(model, var_name, caller, file_path)
        except Exception:
            pass  # Never break user code
        finally:
            del frame

    torch.Tensor.backward = _patched_backward


def _emit_direct(model: Any, var_name: str, frame: Any, file_path: Optional[str] = None) -> None:
    """Emit a model variable record directly to variables.jsonl."""
    try:
        from trickle.type_inference import infer_type

        local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
        os.makedirs(local_dir, exist_ok=True)
        vars_file = os.path.join(local_dir, "variables.jsonl")

        type_node = infer_type(model, max_depth=3)
        type_hash = json.dumps(type_node, sort_keys=True)[:32]

        # Determine file path from frame
        src_file = file_path or frame.f_code.co_filename
        line_no = frame.f_lineno

        record = {
            "kind": "variable",
            "varName": var_name,
            "line": line_no,
            "module": os.path.basename(src_file).rsplit(".", 1)[0],
            "file": src_file,
            "type": type_node,
            "typeHash": type_hash,
            "sample": f"nn.Module({var_name})",
        }

        with open(vars_file, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass


def _emit_gradient(model: Any, var_name: str, frame: Any, file_path: Optional[str] = None) -> None:
    """Emit a gradient flow record with per-layer gradient norms."""
    try:
        layers = _collect_layer_norms(model)
        if not layers:
            return

        local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
        os.makedirs(local_dir, exist_ok=True)
        vars_file = os.path.join(local_dir, "variables.jsonl")

        src_file = file_path or frame.f_code.co_filename
        line_no = frame.f_lineno

        norms = [l["norm"] for l in layers]
        vanishing = [l["name"] for l in layers if l["vanishing"]]
        exploding = [l["name"] for l in layers if l["exploding"]]

        record: Dict[str, Any] = {
            "kind": "gradient",
            "file": src_file,
            "line": line_no,
            "model_var": var_name,
            "layers": layers,
            "max_norm": max(norms),
            "min_norm": min(norms),
            "num_layers": len(layers),
            "vanishing": vanishing,
            "exploding": exploding,
            "timestamp": time.time(),
        }

        with open(vars_file, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass
