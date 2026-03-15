"""Call trace recorder — captures function call/return events with timing
and parent-child relationships for building call graphs.

Written to .trickle/calltrace.jsonl as:
  { "kind": "call", "function": "createUser", "module": "api",
    "parentId": 0, "callId": 1, "depth": 1, "timestamp": 1710516000,
    "durationMs": 2.5 }

Matches the JS call-trace.ts format so the MCP server's get_call_trace
tool works for Python projects too.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional

_trace_file: Optional[str] = None
_call_counter = 0
_call_stack: List[int] = [0]  # Stack of callIds, 0 = top level
_lock = threading.Lock()
_MAX_TRACE_EVENTS = 500
_event_count = 0
_buffer: List[str] = []


def _get_trace_file() -> str:
    global _trace_file
    if _trace_file:
        return _trace_file
    local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
    os.makedirs(local_dir, exist_ok=True)
    _trace_file = os.path.join(local_dir, "calltrace.jsonl")
    # Clear previous run
    try:
        with open(_trace_file, "w"):
            pass
    except OSError:
        pass
    return _trace_file


def _flush_buffer() -> None:
    global _buffer
    if _buffer and _trace_file:
        try:
            with open(_trace_file, "a") as f:
                f.write("\n".join(_buffer) + "\n")
        except Exception:
            pass
        _buffer = []


def _write_event(event: Dict[str, Any]) -> None:
    global _event_count
    if _event_count >= _MAX_TRACE_EVENTS:
        return
    _event_count += 1
    _buffer.append(json.dumps(event))
    if len(_buffer) >= 20:
        _flush_buffer()


def trace_call(function_name: str, module_name: str) -> int:
    """Record a function call. Returns callId for pairing with trace_return."""
    global _call_counter
    with _lock:
        _call_counter += 1
        call_id = _call_counter
        _call_stack.append(call_id)
    return call_id


def trace_return(
    call_id: int,
    function_name: str,
    module_name: str,
    duration_ms: float,
    error: Optional[str] = None,
) -> None:
    """Record a function return with timing."""
    with _lock:
        parent_id = _call_stack[-2] if len(_call_stack) >= 2 else 0
        depth = len(_call_stack) - 1

        event: Dict[str, Any] = {
            "kind": "call",
            "function": function_name,
            "module": module_name,
            "callId": call_id,
            "parentId": parent_id,
            "depth": depth,
            "timestamp": int(time.time() * 1000),
            "durationMs": round(duration_ms, 2),
        }
        if error:
            event["error"] = error[:200]

        _write_event(event)

        # Pop from stack
        if _call_stack and _call_stack[-1] == call_id:
            _call_stack.pop()


def init_call_trace() -> None:
    """Initialize the call trace file. Called at startup."""
    _get_trace_file()
    import atexit
    atexit.register(_flush_buffer)
