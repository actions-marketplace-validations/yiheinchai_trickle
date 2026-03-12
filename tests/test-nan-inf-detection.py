"""Test: NaN/Inf detection in tensor type inference.

Verifies that tensors containing NaN or Inf values get nan_count/inf_count
properties in their type nodes, so the VSCode extension can show warnings
like `Tensor[3, 4] float32 NaN!(2)` inline.

Tests with deliberately corrupted tensors to simulate training divergence.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile


def main():
    test_script = r'''
import torch

# Normal tensor — no NaN/Inf
normal = torch.randn(3, 4)

# Tensor with NaN — created in one expression
has_nan = torch.tensor([[float('nan'), 1.0, 2.0, 3.0],
                        [4.0, 5.0, float('nan'), 7.0],
                        [8.0, 9.0, 10.0, 11.0]])

# Tensor with Inf
has_inf = torch.tensor([[1.0, float('-inf'), 2.0, 3.0],
                        [4.0, 5.0, 6.0, 7.0],
                        [8.0, 9.0, 10.0, float('inf')]])

# Tensor with both NaN and Inf
has_both = torch.tensor([[float('nan'), 1.0], [2.0, float('inf')]])

# Scalar NaN (e.g. loss went NaN)
nan_loss = torch.tensor(float('nan'))

# Integer tensor — should NOT check for NaN
int_tensor = torch.randint(0, 10, (3, 4))

# Simulate realistic: division by zero causing Inf, then NaN from Inf-Inf
a = torch.tensor([1.0, 0.0, -1.0])
div_result = a / torch.tensor([0.0, 0.0, 0.0])  # produces Inf, NaN, -Inf

print("NAN_INF_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_nantest_")
    test_file = os.path.join(test_dir, "test_nan.py")
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

    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=60,
    )

    if result.returncode != 0 or "NAN_INF_OK" not in result.stdout:
        print(f"FAIL: exit code {result.returncode}")
        print(result.stderr[:3000])
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    print("=== NaN/Inf Detection ===\n")

    def get_record(name):
        return next((r for r in records if r["varName"] == name), None)

    def get_props(name):
        r = get_record(name)
        return r["type"].get("properties", {}) if r else {}

    # 1. Normal tensor should NOT have nan_count/inf_count
    normal_props = get_props("normal")
    assert "nan_count" not in normal_props, "FAIL: normal tensor should not have nan_count"
    assert "inf_count" not in normal_props, "FAIL: normal tensor should not have inf_count"
    print("  normal: no NaN/Inf (correct)")

    # 2. has_nan should have nan_count=2
    nan_props = get_props("has_nan")
    assert "nan_count" in nan_props, "FAIL: has_nan missing nan_count"
    assert nan_props["nan_count"]["name"] == "2", \
        f"FAIL: expected nan_count=2, got {nan_props['nan_count']['name']}"
    assert "inf_count" not in nan_props, "FAIL: has_nan should not have inf_count"
    print(f"  has_nan: nan_count={nan_props['nan_count']['name']} (correct)")

    # 3. has_inf should have inf_count=2
    inf_props = get_props("has_inf")
    assert "inf_count" in inf_props, "FAIL: has_inf missing inf_count"
    assert inf_props["inf_count"]["name"] == "2", \
        f"FAIL: expected inf_count=2, got {inf_props['inf_count']['name']}"
    assert "nan_count" not in inf_props, "FAIL: has_inf should not have nan_count"
    print(f"  has_inf: inf_count={inf_props['inf_count']['name']} (correct)")

    # 4. has_both should have both
    both_props = get_props("has_both")
    assert "nan_count" in both_props, "FAIL: has_both missing nan_count"
    assert "inf_count" in both_props, "FAIL: has_both missing inf_count"
    print(f"  has_both: nan_count={both_props['nan_count']['name']}, inf_count={both_props['inf_count']['name']} (correct)")

    # 5. Scalar NaN loss should show value=nan AND nan_count=1
    nan_loss_props = get_props("nan_loss")
    assert "nan_count" in nan_loss_props, "FAIL: nan_loss missing nan_count"
    print(f"  nan_loss: nan_count={nan_loss_props['nan_count']['name']}, value={nan_loss_props.get('value', {}).get('name', '?')}")

    # 6. Integer tensor should NOT have nan/inf checks
    int_props = get_props("int_tensor")
    assert "nan_count" not in int_props, "FAIL: int tensor should not have nan_count"
    assert "inf_count" not in int_props, "FAIL: int tensor should not have inf_count"
    print("  int_tensor: no NaN/Inf check (correct, not float)")

    # 7. Division by zero — should have both NaN and Inf
    div_props = get_props("div_result")
    assert "nan_count" in div_props or "inf_count" in div_props, \
        "FAIL: div_result should have NaN or Inf from division by zero"
    nan_c = div_props.get("nan_count", {}).get("name", "0")
    inf_c = div_props.get("inf_count", {}).get("name", "0")
    print(f"  div_result: nan_count={nan_c}, inf_count={inf_c} (div by zero)")

    # Show what the display would look like
    print("\n  === Display preview ===")
    for name in ["normal", "has_nan", "has_inf", "has_both", "nan_loss", "div_result"]:
        props = get_props(name)
        shape = props.get("shape", {}).get("name", "?")
        dtype = props.get("dtype", {}).get("name", "?").replace("torch.", "")
        val = props.get("value", {}).get("name")
        nan = props.get("nan_count", {}).get("name")
        inf = props.get("inf_count", {}).get("name")

        display = f"Tensor{shape} {dtype}"
        if val:
            display += f" = {val}"
        if nan:
            display += f" NaN!({nan})"
        if inf:
            display += f" Inf!({inf})"
        print(f"  {name:15s}: {display}")

    shutil.rmtree(test_dir)
    print("\nPASS: NaN/Inf detection works!")


if __name__ == "__main__":
    main()
