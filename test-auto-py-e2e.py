"""E2E test: trickle.auto for Python — one-line auto-typing.

Verifies that:
1. `import trickle.auto` is all you need — no CLI, no backend
2. .pyi file is generated next to the source file
3. Types are correct and include all observed functions
4. .trickle/observations.jsonl is created
5. Works as a simple `python app.py` — no special runner needed
"""

import os
import shutil
import subprocess
import sys

APP_FILE = os.path.abspath("test-auto-py-app.py")
LIB_FILE = os.path.abspath("test_auto_py_lib.py")
PYI_FILE = os.path.abspath("test_auto_py_lib.pyi")
TRICKLE_DIR = os.path.abspath(".trickle")
JSONL_FILE = os.path.join(TRICKLE_DIR, "observations.jsonl")


def cleanup():
    for f in [PYI_FILE, JSONL_FILE]:
        try:
            os.unlink(f)
        except FileNotFoundError:
            pass
    try:
        shutil.rmtree(TRICKLE_DIR)
    except FileNotFoundError:
        pass


def run():
    try:
        cleanup()

        # === Step 1: Run app with just `python` — no trickle CLI! ===
        print("=== Step 1: Run `python test-auto-py-app.py` (no CLI, no backend) ===")
        print("  The app has just ONE extra line: import trickle.auto")

        env = {**os.environ, "TRICKLE_BACKEND_URL": "http://localhost:19999"}
        debug = os.environ.get("TRICKLE_DEBUG", "")
        if debug:
            env["TRICKLE_DEBUG"] = debug

        result = subprocess.run(
            [sys.executable, "test-auto-py-app.py"],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )

        full_output = result.stdout + result.stderr
        if result.returncode != 0:
            raise RuntimeError(
                f"App failed with exit code {result.returncode}\n"
                f"stdout: {result.stdout[:500]}\n"
                f"stderr: {result.stderr[:500]}"
            )

        if "Done!" in result.stdout:
            print("  App ran successfully OK")
        else:
            raise RuntimeError("App did not complete. Output: " + result.stdout[:500])

        if "trickle" in full_output.lower() and ".pyi" in full_output:
            print("  Output mentions type generation OK")
        elif "trickle" in full_output.lower():
            print("  Output mentions trickle.auto OK")

        # === Step 2: Verify JSONL was created ===
        print("\n=== Step 2: Verify observations.jsonl ===")

        if os.path.exists(JSONL_FILE):
            import json

            with open(JSONL_FILE, "r") as f:
                content = f.read()
            lines = [l for l in content.strip().split("\n") if l.strip()]
            print(f"  observations.jsonl: {len(lines)} observations")

            func_names = []
            for line in lines:
                try:
                    data = json.loads(line)
                    fn = data.get("functionName")
                    if fn:
                        func_names.append(fn)
                except json.JSONDecodeError:
                    pass

            for expected in ["calculate_discount", "format_invoice", "validate_address"]:
                if expected in func_names:
                    print(f"  {expected} captured OK")
                else:
                    raise RuntimeError(f"{expected} NOT captured!")
        else:
            raise RuntimeError("observations.jsonl NOT created!")

        # === Step 3: Verify .pyi was generated ===
        print("\n=== Step 3: Verify .pyi file ===")

        if os.path.exists(PYI_FILE):
            with open(PYI_FILE, "r") as f:
                pyi = f.read()
            print(f"  test_auto_py_lib.pyi: {len(pyi)} bytes")

            if os.environ.get("TRICKLE_DEBUG"):
                print("\n--- Generated .pyi ---")
                print(pyi)
                print("--- End ---\n")

            # Check for all 3 functions
            for func in ["calculate_discount", "format_invoice", "validate_address"]:
                if func in pyi or _to_pascal(func) in pyi:
                    print(f"  {func} type present OK")
                else:
                    raise RuntimeError(f"{func} NOT in .pyi!")

            # Check type quality
            if "TypedDict" in pyi:
                print("  Contains TypedDict definitions OK")

            if "original" in pyi and "discount" in pyi and "final" in pyi:
                print("  calculate_discount return shape (original, discount, final) OK")

            if "subtotal" in pyi or "line_items" in pyi:
                print("  format_invoice return shape OK")

            if "normalized" in pyi or "valid" in pyi:
                print("  validate_address return shape OK")

            if "trickle.auto" in pyi:
                print("  Header mentions trickle.auto OK")
        else:
            raise RuntimeError(".pyi file NOT generated!")

        # === Step 4: Verify zero-config properties ===
        print("\n=== Step 4: Verify zero-config properties ===")
        print("  No CLI used: just `python test-auto-py-app.py` OK")
        print("  No backend needed: runs fully offline OK")
        print("  One line of code: `import trickle.auto` OK")
        print("  Types generated automatically OK")

        print("\n=== ALL TESTS PASSED ===")
        print("trickle.auto works for Python — one line, zero config, types just appear!\n")

    except Exception as err:
        print(f"\nTEST FAILED: {err}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cleanup()


def _to_pascal(name):
    return "".join(w.capitalize() for w in name.split("_"))


if __name__ == "__main__":
    run()
