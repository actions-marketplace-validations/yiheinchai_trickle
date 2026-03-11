"""Auto-instrumentation hooks for Python web frameworks.

Installs import hooks that patch Flask/FastAPI constructors so any app
created after import is automatically instrumented — zero code changes.

Usage via python -m trickle:

    python -m trickle app.py

Or install hooks manually:

    from trickle._auto import install
    install()
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from typing import Any

logger = logging.getLogger("trickle.auto")

_installed = False


class _TrickleImportHook:
    """Meta path finder that patches framework constructors after import."""

    _TARGETS = frozenset({"flask", "fastapi"})
    _patched: set[str] = set()

    def find_module(self, fullname: str, path: Any = None) -> Any:
        if fullname in self._TARGETS and fullname not in self._patched:
            return self
        return None

    def load_module(self, fullname: str) -> Any:
        self._patched.add(fullname)

        # Temporarily remove ourselves to avoid infinite recursion
        sys.meta_path.remove(self)
        try:
            module = importlib.import_module(fullname)
        finally:
            if self not in sys.meta_path:
                sys.meta_path.insert(0, self)

        _apply_patch(fullname, module)
        return module


def _apply_patch(name: str, module: Any) -> None:
    """Monkey-patch framework constructors to auto-instrument new apps."""
    try:
        if name == "flask":
            _patch_flask(module)
        elif name == "fastapi":
            _patch_fastapi(module)
    except Exception:
        logger.debug("trickle: failed to patch %s", name, exc_info=True)


def _patch_flask(flask_mod: Any) -> None:
    if not hasattr(flask_mod, "Flask"):
        return

    orig_init = flask_mod.Flask.__init__

    def _patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        orig_init(self, *args, **kwargs)
        try:
            from trickle import instrument_flask

            instrument_flask(self)
            logger.debug("trickle: auto-instrumented Flask app")
        except Exception:
            logger.debug("trickle: failed to instrument Flask", exc_info=True)

    flask_mod.Flask.__init__ = _patched_init


def _patch_fastapi(fastapi_mod: Any) -> None:
    if not hasattr(fastapi_mod, "FastAPI"):
        return

    orig_init = fastapi_mod.FastAPI.__init__

    def _patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        orig_init(self, *args, **kwargs)
        try:
            from trickle import instrument_fastapi

            instrument_fastapi(self)
            logger.debug("trickle: auto-instrumented FastAPI app")
        except Exception:
            logger.debug("trickle: failed to instrument FastAPI", exc_info=True)

    fastapi_mod.FastAPI.__init__ = _patched_init


def install() -> None:
    """Install auto-instrumentation import hooks.

    Reads configuration from environment variables:
        TRICKLE_BACKEND_URL — Backend URL (default: http://localhost:4888)
        TRICKLE_ENABLED     — "0" or "false" to disable
        TRICKLE_DEBUG       — "1" or "true" for debug output
    """
    global _installed
    if _installed:
        return
    _installed = True

    enabled = os.environ.get("TRICKLE_ENABLED", "1").lower() not in ("0", "false")
    if not enabled:
        return

    backend_url = os.environ.get("TRICKLE_BACKEND_URL", "http://localhost:4888")
    debug = os.environ.get("TRICKLE_DEBUG", "").lower() in ("1", "true", "yes")

    from trickle import configure

    configure(backend_url=backend_url)

    if debug:
        logging.basicConfig(level=logging.DEBUG)
        logger.debug("trickle: auto-instrumentation enabled (backend: %s)", backend_url)

    hook = _TrickleImportHook()
    sys.meta_path.insert(0, hook)
