"""HTTP request observer — patches ``requests`` and ``httpx`` to automatically
capture request/response types from HTTP calls made by user code.

When your Python app does::

    resp = requests.get("https://api.example.com/users")
    users = resp.json()

Trickle captures:
    - Function name: ``GET /users`` (method + path)
    - Module: ``api.example.com`` (hostname)
    - Input type: request body (for POST/PUT/PATCH)
    - Return type: inferred from JSON response
    - Sample data: actual response payload

The observer only intercepts when ``.json()`` is called, so non-JSON
responses are ignored and the original response is never modified.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional, Set
from urllib.parse import urlparse

logger = logging.getLogger("trickle.http")

_installed = False
_sent_hashes: Set[str] = set()


def patch_http(environment: str = "default", debug: bool = False) -> None:
    """Patch ``requests`` and ``httpx`` to observe JSON responses.

    Safe to call multiple times (idempotent). Only patches libraries that
    are actually importable.
    """
    global _installed
    if _installed:
        return
    _installed = True

    _try_patch_requests(environment, debug)
    _try_patch_httpx(environment, debug)


# ---------------------------------------------------------------------------
# requests patching
# ---------------------------------------------------------------------------

def _try_patch_requests(environment: str, debug: bool) -> None:
    """Monkey-patch ``requests.Session.send`` to observe JSON responses."""
    try:
        import requests  # noqa: F811
    except ImportError:
        return

    original_send = requests.Session.send

    if getattr(original_send, "_trickle_patched", False):
        return

    def patched_send(self: Any, request: Any, **kwargs: Any) -> Any:
        response = original_send(self, request, **kwargs)

        try:
            content_type = response.headers.get("content-type", "")
            if "json" in content_type:
                _capture_requests_response(
                    request.method or "GET",
                    request.url or "",
                    request.body,
                    response,
                    environment,
                    debug,
                )
        except Exception:
            pass  # Never interfere with the app

        return response

    patched_send._trickle_patched = True  # type: ignore[attr-defined]
    requests.Session.send = patched_send  # type: ignore[assignment]

    if debug:
        logger.debug("trickle: patched requests.Session.send")


def _capture_requests_response(
    method: str,
    url: str,
    request_body: Any,
    response: Any,
    environment: str,
    debug: bool,
) -> None:
    """Read the response JSON and capture the type."""
    try:
        data = response.json()
    except Exception:
        return

    _capture_http_type(
        method=method.upper(),
        url=url,
        request_body=request_body,
        response_data=data,
        environment=environment,
        debug=debug,
    )


# ---------------------------------------------------------------------------
# httpx patching
# ---------------------------------------------------------------------------

def _try_patch_httpx(environment: str, debug: bool) -> None:
    """Monkey-patch ``httpx.Client.send`` and ``httpx.AsyncClient.send``."""
    try:
        import httpx
    except ImportError:
        return

    # Patch sync client
    original_sync_send = httpx.Client.send
    if not getattr(original_sync_send, "_trickle_patched", False):
        def patched_sync_send(self: Any, request: Any, **kwargs: Any) -> Any:
            response = original_sync_send(self, request, **kwargs)
            try:
                content_type = response.headers.get("content-type", "")
                if "json" in content_type:
                    _capture_httpx_response(
                        str(request.method),
                        str(request.url),
                        request.content,
                        response,
                        environment,
                        debug,
                    )
            except Exception:
                pass
            return response

        patched_sync_send._trickle_patched = True  # type: ignore[attr-defined]
        httpx.Client.send = patched_sync_send  # type: ignore[assignment]

    # Patch async client
    original_async_send = httpx.AsyncClient.send
    if not getattr(original_async_send, "_trickle_patched", False):
        async def patched_async_send(self: Any, request: Any, **kwargs: Any) -> Any:
            response = await original_async_send(self, request, **kwargs)
            try:
                content_type = response.headers.get("content-type", "")
                if "json" in content_type:
                    _capture_httpx_response(
                        str(request.method),
                        str(request.url),
                        request.content,
                        response,
                        environment,
                        debug,
                    )
            except Exception:
                pass
            return response

        patched_async_send._trickle_patched = True  # type: ignore[attr-defined]
        httpx.AsyncClient.send = patched_async_send  # type: ignore[assignment]

    if debug:
        logger.debug("trickle: patched httpx.Client.send + httpx.AsyncClient.send")


def _capture_httpx_response(
    method: str,
    url: str,
    request_body: Any,
    response: Any,
    environment: str,
    debug: bool,
) -> None:
    """Read the httpx response JSON and capture the type."""
    try:
        data = response.json()
    except Exception:
        return

    # httpx request body is bytes
    body_str: Optional[str] = None
    if request_body:
        if isinstance(request_body, bytes):
            try:
                body_str = request_body.decode("utf-8")
            except Exception:
                pass
        elif isinstance(request_body, str):
            body_str = request_body

    _capture_http_type(
        method=method.upper(),
        url=url,
        request_body=body_str,
        response_data=data,
        environment=environment,
        debug=debug,
    )


# ---------------------------------------------------------------------------
# Shared capture logic
# ---------------------------------------------------------------------------

_ID_PATTERNS = [
    (re.compile(r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I), "/:uuid"),  # UUID
    (re.compile(r"/[0-9a-f]{24}(?=/|$)", re.I), "/:id"),  # MongoDB ObjectId (24 hex chars)
    (re.compile(r"/[0-9a-f]{8,}(?=/|$)", re.I), "/:id"),  # Generic hex ID (8+ chars)
    (re.compile(r"/\d+(?=/|$)"), "/:id"),  # Numeric ID
]


def _normalize_path(pathname: str) -> str:
    """Replace literal IDs in URL paths with placeholders to avoid cardinality explosion.

    ``/users/abc123/tasks/456`` → ``/users/:id/tasks/:id``
    ``/items/550e8400-e29b-41d4-a716-446655440000`` → ``/items/:uuid``
    """
    for pattern, replacement in _ID_PATTERNS:
        pathname = pattern.sub(replacement, pathname)
    return pathname


def _parse_url(method: str, raw_url: str) -> Dict[str, str]:
    """Parse a URL into a clean function name and module name.

    ``"https://api.example.com/v1/users?limit=10"``
    → ``functionName: "GET /v1/users"``, ``module: "api.example.com"``
    """
    try:
        parsed = urlparse(raw_url)
        pathname = _normalize_path(parsed.path or "/")
        return {
            "functionName": f"{method} {pathname}",
            "module": parsed.hostname or "http",
        }
    except Exception:
        return {
            "functionName": f"{method} {raw_url}",
            "module": "http",
        }


def _sanitize_sample(value: Any, depth: int = 3) -> Any:
    """Truncate large values so they don't bloat the payload."""
    if depth <= 0:
        return "[truncated]"
    if value is None:
        return value
    if isinstance(value, str):
        return value[:200] + "..." if len(value) > 200 else value
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return [_sanitize_sample(item, depth - 1) for item in value[:5]]
    if isinstance(value, dict):
        result = {}
        for k in list(value.keys())[:20]:
            try:
                result[k] = _sanitize_sample(value[k], depth - 1)
            except Exception:
                result[k] = "[unreadable]"
        return result
    return str(value)


_SKIP_URL_PATTERNS = ("/api/ingest", "/api/functions", "/api/health", "/api/types")


def _capture_http_type(
    method: str,
    url: str,
    request_body: Any,
    response_data: Any,
    environment: str,
    debug: bool,
) -> None:
    """Infer types from the HTTP exchange and enqueue to the backend."""
    # Skip trickle's own backend calls
    if any(pat in url for pat in _SKIP_URL_PATTERNS):
        return
    from .type_inference import infer_type
    from .type_hash import hash_type
    from .transport import enqueue

    parsed = _parse_url(method, url)
    function_name = parsed["functionName"]
    module_name = parsed["module"]

    # Infer response type
    return_type = infer_type(response_data, 5)

    # Infer request body type (for POST/PUT/PATCH)
    args_type: Dict[str, Any]
    parsed_body: Any = None
    body_str: Optional[str] = None
    if request_body:
        if isinstance(request_body, bytes):
            try:
                body_str = request_body.decode("utf-8")
            except Exception:
                pass
        elif isinstance(request_body, str):
            body_str = request_body

    if body_str:
        try:
            import json
            parsed_body = json.loads(body_str)
            args_type = {"kind": "tuple", "elements": [infer_type(parsed_body, 5)]}
        except Exception:
            args_type = {"kind": "tuple", "elements": []}
    else:
        args_type = {"kind": "tuple", "elements": []}

    type_hash = hash_type(args_type, return_type)

    # Dedup — only send each unique type shape once
    key = f"{function_name}::{type_hash}"
    if key in _sent_hashes:
        return
    _sent_hashes.add(key)

    # Build payload (camelCase keys to match backend)
    payload: Dict[str, Any] = {
        "functionName": function_name,
        "module": module_name,
        "language": "python",
        "environment": environment,
        "typeHash": type_hash,
        "argsType": args_type,
        "returnType": return_type,
        "sampleOutput": _sanitize_sample(response_data),
    }

    if parsed_body is not None:
        payload["sampleInput"] = [_sanitize_sample(parsed_body)]

    enqueue(payload)

    if debug:
        logger.debug("trickle/http: captured %s → %s", function_name, _describe_type(return_type))


def _describe_type(type_node: Dict[str, Any]) -> str:
    """Brief description of a type for debug logging."""
    kind = type_node.get("kind", "unknown")
    if kind == "object":
        props = list(type_node.get("properties", {}).keys())
        if len(props) <= 4:
            return "{ " + ", ".join(props) + " }"
        return "{ " + ", ".join(props[:3]) + f", ... }} ({len(props)} props)"
    if kind == "array":
        return _describe_type(type_node.get("element", {})) + "[]"
    if kind == "primitive":
        return type_node.get("name", "unknown")
    return kind
