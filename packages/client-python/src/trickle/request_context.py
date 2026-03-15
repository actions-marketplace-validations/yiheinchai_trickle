"""Request context — propagates a request ID through Python async/sync call chains.

Uses Python's contextvars (3.7+) so that all functions, queries, and logs
within a single HTTP request share the same request_id.

For Flask::

    from trickle.request_context import flask_middleware
    app.before_request(flask_middleware)

For FastAPI::

    from trickle.request_context import fastapi_middleware
    app.middleware("http")(fastapi_middleware)

For Django::

    # In settings.py MIDDLEWARE:
    'trickle.request_context.DjangoTrickleMiddleware'
"""

from __future__ import annotations

import contextvars
import time
from typing import Any, Optional

_request_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "trickle_request_id", default=None
)
_counter = 0


def _generate_id() -> str:
    global _counter
    _counter += 1
    return f"req-{_counter}-{int(time.time()) % 100000:05d}"


def get_request_id() -> Optional[str]:
    """Get the current request's ID (if inside a request context)."""
    return _request_id.get()


def set_request_id(rid: str) -> None:
    """Set the request ID for the current context."""
    _request_id.set(rid)


# ── Flask ──

def flask_middleware() -> None:
    """Flask before_request hook that sets a request ID."""
    set_request_id(_generate_id())


# ── FastAPI / Starlette ──

async def fastapi_middleware(request: Any, call_next: Any) -> Any:
    """FastAPI/Starlette middleware that sets a request ID."""
    set_request_id(_generate_id())
    response = await call_next(request)
    return response


# ── Django ──

class DjangoTrickleMiddleware:
    """Django middleware that sets a request ID per request."""

    def __init__(self, get_response: Any) -> None:
        self.get_response = get_response

    def __call__(self, request: Any) -> Any:
        set_request_id(_generate_id())
        return self.get_response(request)


def install_request_context() -> None:
    """Auto-install request context for detected frameworks.

    Called by observe_runner. Patches Flask/FastAPI/Django if detected.
    """
    # Flask
    try:
        from flask import Flask
        _original_flask_init = Flask.__init__

        def _patched_flask_init(self: Any, *args: Any, **kwargs: Any) -> None:
            _original_flask_init(self, *args, **kwargs)
            self.before_request(flask_middleware)

        if not getattr(Flask.__init__, '_trickle_patched', False):
            Flask.__init__ = _patched_flask_init  # type: ignore
            Flask.__init__._trickle_patched = True  # type: ignore
    except ImportError:
        pass
