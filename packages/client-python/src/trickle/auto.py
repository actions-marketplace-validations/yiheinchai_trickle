"""trickle.auto — Zero-config type generation for Python.

Add ONE LINE to your app and .pyi type stubs appear automatically::

    import trickle.auto

This module:
1. Forces local mode (no backend needed)
2. Installs the import hook to wrap all user functions
3. Runs a background thread that generates .pyi files from observations
4. On process exit, does a final type generation

No CLI. No backend. No configuration. Just types.
"""

from __future__ import annotations

import atexit
import os
import sys
import threading

# Force local mode BEFORE importing anything that calls configure
os.environ["TRICKLE_LOCAL"] = "1"

# Install the auto-observe import hook (wraps all user module functions)
from trickle._observe_auto import install as _install_observe_hook  # noqa: E402
_install_observe_hook()

# Import the codegen
from trickle._auto_codegen import generate_types  # noqa: E402

_debug = os.environ.get("TRICKLE_DEBUG", "").lower() in ("1", "true", "yes")
_last_function_count = 0
_generation_count = 0
_stop_event = threading.Event()


def _run_generation(is_final: bool) -> None:
    """Run type generation and optionally log results."""
    global _last_function_count, _generation_count

    try:
        count = generate_types()
        if count == -1:
            return  # no change

        if count > 0:
            _generation_count += 1
            new_types = count - _last_function_count
            if new_types > 0 and _generation_count > 1:
                print(f"[trickle.auto] +{new_types} type(s) generated ({count} total)")
            _last_function_count = count

        if is_final and _last_function_count > 0:
            print(f"[trickle.auto] {_last_function_count} function type(s) written to .pyi")
    except Exception:
        # Never crash user's app
        pass


def _background_worker() -> None:
    """Background thread that regenerates types every 3 seconds."""
    while not _stop_event.wait(timeout=3.0):
        _run_generation(False)


# Start background thread (daemon so it doesn't keep the process alive)
_worker = threading.Thread(target=_background_worker, daemon=True, name="trickle-auto-codegen")
_worker.start()

# Also do a first check after 1 second
_initial_timer = threading.Timer(1.0, lambda: _run_generation(False))
_initial_timer.daemon = True
_initial_timer.start()


# Final generation on exit
def _exit_handler() -> None:
    _stop_event.set()
    _run_generation(True)


atexit.register(_exit_handler)
