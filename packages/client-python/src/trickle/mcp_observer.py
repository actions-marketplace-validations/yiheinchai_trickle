"""MCP tool call observer — auto-instruments MCP client and server SDKs.

Captures tool invocations, arguments, responses, latency, and errors.
Writes to .trickle/mcp.jsonl.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

_debug = False
_mcp_file: str | None = None
_event_count = 0
_MAX_EVENTS = 1000
_TRUNCATE_LEN = 500


def _get_mcp_file() -> str:
    global _mcp_file
    if _mcp_file:
        return _mcp_file
    local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
    os.makedirs(local_dir, exist_ok=True)
    _mcp_file = os.path.join(local_dir, "mcp.jsonl")
    return _mcp_file


def _write_event(event: dict[str, Any]) -> None:
    global _event_count
    if _event_count >= _MAX_EVENTS:
        return
    _event_count += 1
    try:
        with open(_get_mcp_file(), "a") as f:
            f.write(json.dumps(event) + "\n")
    except Exception:
        pass


def _truncate(s: str, length: int = _TRUNCATE_LEN) -> str:
    if not s:
        return ""
    return s[:length] + "..." if len(s) > length else s


def _sanitize_args(args: Any) -> Any:
    if args is None:
        return None
    try:
        s = json.dumps(args)
        return json.loads(s[:1000]) if len(s) > 1000 else args
    except Exception:
        return str(args)[:200]


def _extract_result_preview(result: Any) -> str:
    if not result:
        return ""
    content = getattr(result, "content", None)
    if content and isinstance(content, list):
        texts = []
        for c in content:
            if getattr(c, "type", None) == "text" and getattr(c, "text", None):
                texts.append(c.text)
        return _truncate("\n".join(texts))
    if isinstance(result, str):
        return _truncate(result)
    try:
        return _truncate(json.dumps(result))
    except Exception:
        return ""


# ────────────────────────────────────────────────────
# Client-side: patch ClientSession.call_tool
# ────────────────────────────────────────────────────


def patch_mcp_client(mcp_module: Any) -> None:
    """Patch the MCP Python SDK client to capture tool calls."""
    if getattr(mcp_module, "_trickle_mcp_patched", False):
        return
    mcp_module._trickle_mcp_patched = True

    # mcp.ClientSession has call_tool method
    ClientSession = None
    try:
        from mcp import ClientSession as CS
        ClientSession = CS
    except ImportError:
        try:
            ClientSession = getattr(mcp_module, "ClientSession", None)
        except Exception:
            pass

    if ClientSession is None:
        return

    if hasattr(ClientSession, "call_tool") and not getattr(ClientSession.call_tool, "_trickle_patched", False):
        _orig_call_tool = ClientSession.call_tool

        async def _patched_call_tool(self: Any, name: str, arguments: Any = None, **kwargs: Any) -> Any:
            start = time.perf_counter()
            error_msg = None
            result = None
            try:
                result = await _orig_call_tool(self, name, arguments, **kwargs)
                return result
            except Exception as e:
                error_msg = str(e)[:200]
                raise
            finally:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                is_error = bool(error_msg) or (result is not None and getattr(result, "is_error", False))
                _write_event({
                    "kind": "mcp_tool_call",
                    "tool": name,
                    "direction": "outgoing",
                    "durationMs": duration_ms,
                    "args": _sanitize_args(arguments),
                    "resultPreview": _extract_result_preview(result) if not error_msg else "",
                    "isError": is_error,
                    "errorMessage": error_msg or (_extract_result_preview(result) if is_error else None),
                    "timestamp": int(time.time() * 1000),
                })
                if _debug:
                    print(f"[trickle/mcp] call_tool: {name} ({duration_ms}ms)")

        _patched_call_tool._trickle_patched = True  # type: ignore
        ClientSession.call_tool = _patched_call_tool

    # Also patch list_tools
    if hasattr(ClientSession, "list_tools") and not getattr(ClientSession.list_tools, "_trickle_patched", False):
        _orig_list_tools = ClientSession.list_tools

        async def _patched_list_tools(self: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            result = await _orig_list_tools(self, **kwargs)
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            tool_count = len(getattr(result, "tools", []) or [])
            _write_event({
                "kind": "mcp_tool_call",
                "tool": "__list_tools",
                "direction": "outgoing",
                "durationMs": duration_ms,
                "args": None,
                "resultPreview": f"{tool_count} tools available",
                "isError": False,
                "timestamp": int(time.time() * 1000),
            })
            return result

        _patched_list_tools._trickle_patched = True  # type: ignore
        ClientSession.list_tools = _patched_list_tools

    if _debug:
        print("[trickle/mcp] Patched MCP ClientSession")


# ────────────────────────────────────────────────────
# Server-side: patch FastMCP tool decorator
# ────────────────────────────────────────────────────


def patch_mcp_server(mcp_module: Any) -> None:
    """Patch the MCP Python SDK server to capture incoming tool calls."""
    if getattr(mcp_module, "_trickle_mcp_server_patched", False):
        return
    mcp_module._trickle_mcp_server_patched = True

    # FastMCP has a .tool() decorator
    FastMCP = None
    try:
        from mcp.server.fastmcp import FastMCP as FM
        FastMCP = FM
    except ImportError:
        pass

    if FastMCP is None:
        return

    if hasattr(FastMCP, "tool") and not getattr(FastMCP.tool, "_trickle_patched", False):
        _orig_tool = FastMCP.tool

        def _patched_tool(self: Any, *args: Any, **kwargs: Any) -> Any:
            decorator = _orig_tool(self, *args, **kwargs)

            def _wrapping_decorator(fn: Any) -> Any:
                registered = decorator(fn)
                tool_name = getattr(fn, "__name__", "unknown")

                # Wrap the registered function
                import functools
                import asyncio

                if asyncio.iscoroutinefunction(fn):
                    @functools.wraps(fn)
                    async def _wrapped(*a: Any, **kw: Any) -> Any:
                        start = time.perf_counter()
                        error_msg = None
                        result = None
                        try:
                            result = await fn(*a, **kw)
                            return result
                        except Exception as e:
                            error_msg = str(e)[:200]
                            raise
                        finally:
                            duration_ms = round((time.perf_counter() - start) * 1000, 2)
                            _write_event({
                                "kind": "mcp_tool_call",
                                "tool": tool_name,
                                "direction": "incoming",
                                "durationMs": duration_ms,
                                "args": _sanitize_args(kw or (a[0] if a else None)),
                                "resultPreview": _truncate(str(result)[:500]) if result and not error_msg else "",
                                "isError": bool(error_msg),
                                "errorMessage": error_msg,
                                "timestamp": int(time.time() * 1000),
                            })
                    return _wrapped
                else:
                    @functools.wraps(fn)
                    def _wrapped_sync(*a: Any, **kw: Any) -> Any:
                        start = time.perf_counter()
                        error_msg = None
                        result = None
                        try:
                            result = fn(*a, **kw)
                            return result
                        except Exception as e:
                            error_msg = str(e)[:200]
                            raise
                        finally:
                            duration_ms = round((time.perf_counter() - start) * 1000, 2)
                            _write_event({
                                "kind": "mcp_tool_call",
                                "tool": tool_name,
                                "direction": "incoming",
                                "durationMs": duration_ms,
                                "args": _sanitize_args(kw or (a[0] if a else None)),
                                "resultPreview": _truncate(str(result)[:500]) if result and not error_msg else "",
                                "isError": bool(error_msg),
                                "errorMessage": error_msg,
                                "timestamp": int(time.time() * 1000),
                            })
                    return _wrapped_sync

            # If original .tool() is used as a bare decorator (no args), handle that
            if args and callable(args[0]):
                return _wrapping_decorator(args[0])
            return _wrapping_decorator

        _patched_tool._trickle_patched = True  # type: ignore
        FastMCP.tool = _patched_tool

    if _debug:
        print("[trickle/mcp] Patched FastMCP server")


# ────────────────────────────────────────────────────
# Installation
# ────────────────────────────────────────────────────


def patch_mcp(debug: bool = False) -> None:
    """Install MCP observer hooks."""
    global _debug
    _debug = debug

    import sys

    # Clear previous data
    try:
        f = _get_mcp_file()
        with open(f, "w") as fp:
            fp.truncate(0)
    except Exception:
        pass

    # Patch already-imported modules
    if "mcp" in sys.modules:
        try:
            patch_mcp_client(sys.modules["mcp"])
        except Exception:
            pass
    if "mcp.server.fastmcp" in sys.modules:
        try:
            patch_mcp_server(sys.modules["mcp.server.fastmcp"])
        except Exception:
            pass

    # Register with the consolidated import hook
    try:
        from trickle.db_observer import register_import_patches
        register_import_patches({
            "mcp": patch_mcp_client,
            "mcp.server.fastmcp": patch_mcp_server,
        })
    except Exception:
        pass
