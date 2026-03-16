"""Agent memory observer — auto-instruments Mem0 memory operations.

Captures memory add/get/search/update/delete with zero code changes.
Writes to .trickle/memory.jsonl.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

_debug = False
_memory_file: str | None = None
_event_count = 0
_MAX_EVENTS = 500


def _get_memory_file() -> str:
    global _memory_file
    if _memory_file:
        return _memory_file
    local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
    os.makedirs(local_dir, exist_ok=True)
    _memory_file = os.path.join(local_dir, "memory.jsonl")
    return _memory_file


def _write_event(event: dict[str, Any]) -> None:
    global _event_count
    if _event_count >= _MAX_EVENTS:
        return
    _event_count += 1
    try:
        with open(_get_memory_file(), "a") as f:
            f.write(json.dumps(event, default=str) + "\n")
    except Exception:
        pass


def _truncate(s: str, length: int = 200) -> str:
    if not s:
        return ""
    return s[:length] + "..." if len(s) > length else s


def patch_mem0(mem0_module: Any) -> None:
    """Patch Mem0's Memory class to capture memory operations."""
    if getattr(mem0_module, "_trickle_memory_patched", False):
        return
    mem0_module._trickle_memory_patched = True

    MemoryClass = getattr(mem0_module, "Memory", None)
    if MemoryClass is None:
        return

    # Clear previous data
    try:
        f = _get_memory_file()
        with open(f, "w") as fp:
            fp.truncate(0)
    except Exception:
        pass

    _methods_to_patch = ["add", "get", "get_all", "search", "update", "delete"]

    for method_name in _methods_to_patch:
        orig = getattr(MemoryClass, method_name, None)
        if orig is None or getattr(orig, "_trickle_patched", False):
            continue

        def _make_wrapper(name: str, original: Any) -> Any:
            def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
                start = time.perf_counter()
                error_msg = None
                result = None
                try:
                    result = original(self, *args, **kwargs)
                    return result
                except Exception as e:
                    error_msg = str(e)[:200]
                    raise
                finally:
                    duration_ms = round((time.perf_counter() - start) * 1000, 2)

                    event: dict[str, Any] = {
                        "kind": "memory_op",
                        "operation": name,
                        "durationMs": duration_ms,
                        "timestamp": int(time.time() * 1000),
                    }

                    # Capture operation-specific data
                    if name == "add":
                        data = args[0] if args else kwargs.get("data", "")
                        event["input"] = _truncate(str(data))
                        event["userId"] = kwargs.get("user_id") or (args[1] if len(args) > 1 else None)
                        if result and isinstance(result, dict):
                            event["memoriesAdded"] = len(result.get("results", []))
                    elif name == "search":
                        query = args[0] if args else kwargs.get("query", "")
                        event["query"] = _truncate(str(query))
                        event["userId"] = kwargs.get("user_id")
                        if result and isinstance(result, dict):
                            event["resultsCount"] = len(result.get("results", []))
                    elif name == "get":
                        event["memoryId"] = args[0] if args else kwargs.get("memory_id")
                    elif name == "get_all":
                        event["userId"] = kwargs.get("user_id") or (args[0] if args else None)
                        if result and isinstance(result, dict):
                            event["memoriesCount"] = len(result.get("results", []))
                    elif name == "update":
                        event["memoryId"] = args[0] if args else kwargs.get("memory_id")
                        event["newData"] = _truncate(str(args[1] if len(args) > 1 else kwargs.get("data", "")))
                    elif name == "delete":
                        event["memoryId"] = args[0] if args else kwargs.get("memory_id")

                    if error_msg:
                        event["error"] = error_msg

                    _write_event(event)
                    if _debug:
                        print(f"[trickle/memory] {name} ({duration_ms}ms)")

            wrapper._trickle_patched = True  # type: ignore
            return wrapper

        setattr(MemoryClass, method_name, _make_wrapper(method_name, orig))

    if _debug:
        print("[trickle/memory] Patched Mem0 Memory class")


def patch_memory(debug: bool = False) -> None:
    """Install memory observer hooks."""
    global _debug
    _debug = debug

    import sys

    if "mem0" in sys.modules:
        try:
            patch_mem0(sys.modules["mem0"])
        except Exception:
            pass

    try:
        from trickle.db_observer import register_import_patches
        register_import_patches({"mem0": patch_mem0})
    except Exception:
        pass
