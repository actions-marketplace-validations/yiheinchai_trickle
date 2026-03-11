"""Run a Python application with trickle auto-instrumentation.

Usage:
    python -m trickle app.py           # Run a script
    python -m trickle mypackage        # Run a package/module
    python -m trickle myapp:create_app # Run with app factory (future)

Environment variables:
    TRICKLE_BACKEND_URL — Backend URL (default: http://localhost:4888)
    TRICKLE_ENABLED     — "0" or "false" to disable
    TRICKLE_DEBUG       — "1" or "true" for debug output
"""

from __future__ import annotations

import runpy
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m trickle <script.py | module>")
        print()
        print("Runs your application with automatic trickle instrumentation.")
        print("No code changes needed — Flask and FastAPI apps are auto-detected.")
        print()
        print("Environment variables:")
        print("  TRICKLE_BACKEND_URL  Backend URL (default: http://localhost:4888)")
        print("  TRICKLE_ENABLED      Set to '0' to disable")
        print("  TRICKLE_DEBUG        Set to '1' for debug logging")
        sys.exit(1)

    # Install auto-instrumentation hooks BEFORE loading the user's code
    from trickle._auto import install

    install()

    target = sys.argv[1]

    # Shift argv so the target script sees itself as sys.argv[0]
    sys.argv = sys.argv[1:]

    if target.endswith(".py"):
        # Run as a script file
        runpy.run_path(target, run_name="__main__")
    else:
        # Run as a module
        runpy.run_module(target, run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
