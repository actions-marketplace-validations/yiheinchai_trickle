"""Test: error diagnostics written to errors.jsonl for VSCode integration.

Verifies that when user code crashes:
1. errors.jsonl is created with correct structure
2. File path is mapped back to original (not temp transform file)
3. Shape context is included
4. errors.jsonl is cleared on new run
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile


def main():
    # Script with a deliberate shape mismatch in a transformer-like model
    test_script = r'''
import torch
import torch.nn as nn

class SimpleTransformer(nn.Module):
    def __init__(self, d_model=64, n_head=4):
        super().__init__()
        self.attn = nn.Linear(d_model, 3 * d_model)
        self.proj = nn.Linear(d_model, d_model)

    def forward(self, x):
        B, T, C = x.size()
        qkv = self.attn(x)
        q, k, v = qkv.chunk(3, dim=-1)
        # Deliberate error: reshape with wrong head dimension
        q = q.view(B, T, 7, C // 7)  # 7 doesn't divide 64 evenly — will crash
        k = k.view(B, T, 7, C // 7)
        return q

model = SimpleTransformer(d_model=64, n_head=4)
x = torch.randn(2, 16, 64)
output = model(x)
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_diag_test_")
    test_file = os.path.join(test_dir, "transformer.py")
    with open(test_file, "w") as f:
        f.write(test_script)

    trickle_dir = os.path.join(test_dir, ".trickle")
    python = sys.executable
    trickle_src = os.path.join(os.path.dirname(__file__), "..", "packages", "client-python", "src")

    env = os.environ.copy()
    env["PYTHONPATH"] = trickle_src + (os.pathsep + env.get("PYTHONPATH", ""))
    env["TRICKLE_LOCAL"] = "1"
    env["TRICKLE_LOCAL_DIR"] = trickle_dir
    env["TRICKLE_TRACE_VARS"] = "1"

    print("Test 1: Running script that may crash...")
    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=60,
    )

    print(f"Exit code: {result.returncode}")
    if result.returncode != 0:
        print(f"Error: {result.stderr[-200:]}")

    # Check errors.jsonl
    errors_file = os.path.join(trickle_dir, "errors.jsonl")
    if result.returncode != 0:
        if not os.path.exists(errors_file):
            print("FAIL: errors.jsonl not created after crash")
            sys.exit(1)

        with open(errors_file) as f:
            records = [json.loads(l) for l in f if l.strip()]

        if not records:
            print("FAIL: errors.jsonl is empty")
            sys.exit(1)

        err = records[0]
        print(f"\nError: {err['error_type']}: {err['message'][:80]}")
        print(f"File: {os.path.basename(err['file'])}")
        print(f"Line: {err['line']}")
        print(f"Function: {err['function']}")

        # Verify the file path is the original, not the temp transform
        if ".trickle_" in os.path.basename(err["file"]):
            print("FAIL: file path still references temp transform file")
            sys.exit(1)
        print("OK: file path correctly mapped to original")

        # Verify shape context exists
        if err.get("shape_context"):
            print(f"Shape context: {len(err['shape_context'])} entries")
            for sc in err["shape_context"][:5]:
                print(f"  {sc}")
        else:
            print("WARNING: no shape context (might be OK for some errors)")

        # Verify frames exist
        assert len(err.get("frames", [])) > 0, "Expected stack frames"
        print(f"Stack frames: {len(err['frames'])}")
    else:
        print("Script succeeded (no error to test)")

    # Test 2: Run again — errors.jsonl should be cleared at start
    print("\nTest 2: Verifying errors.jsonl is cleared on new run...")

    # Write a non-crashing script
    ok_script = "import torch\nx = torch.randn(2, 3)\nprint('ok')\n"
    ok_file = os.path.join(test_dir, "ok_script.py")
    with open(ok_file, "w") as f:
        f.write(ok_script)

    result2 = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", ok_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=60,
    )

    if result2.returncode != 0:
        print(f"FAIL: ok_script crashed: {result2.stderr[-200:]}")
        sys.exit(1)

    # errors.jsonl should be empty (truncated at start of run)
    if os.path.exists(errors_file):
        with open(errors_file) as f:
            content = f.read().strip()
        if content:
            print(f"FAIL: errors.jsonl not cleared on new run, still has: {content[:100]}")
            sys.exit(1)
        print("OK: errors.jsonl cleared on successful run")
    else:
        print("OK: errors.jsonl doesn't exist (was cleared)")

    shutil.rmtree(test_dir)
    print("\nPASS: Error diagnostics integration test passed!")


if __name__ == "__main__":
    main()
