"""Test: Scalar tensor values are captured in trace records.

Verifies that 0-dim and 1-element tensors include their actual numeric
value in the type properties (e.g. loss = 4.127), so the VSCode extension
can show `loss: Tensor[] float32 = 4.127` inline.

Tests on nanoGPT where model(x, y) returns (logits, loss).
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile


def main():
    test_script = r'''
import sys
sys.path.insert(0, "/tmp/nanoGPT")

import torch
from model import GPTConfig, GPT

config = GPTConfig(
    block_size=32,
    vocab_size=64,
    n_layer=2,
    n_head=2,
    n_embd=32,
    dropout=0.0,
    bias=False,
)
model = GPT(config)

x = torch.randint(0, 64, (2, 16))
y = torch.randint(0, 64, (2, 16))
logits, loss = model(x, y)
print("SCALAR_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_scalar_")
    test_file = os.path.join(test_dir, "test_scalar.py")
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
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=120,
    )

    if result.returncode != 0 or "SCALAR_OK" not in result.stdout:
        print(f"FAIL: exit code {result.returncode}")
        print(result.stderr[:3000])
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    print("=== Scalar Tensor Values ===\n")

    # Find loss records (should be scalar tensor)
    loss_records = [r for r in records
                    if r.get("varName") in ("loss", "<return:loss>")
                    and r.get("type", {}).get("class_name") == "Tensor"]

    print(f"  Loss tensor records: {len(loss_records)}")

    for r in loss_records:
        props = r["type"].get("properties", {})
        shape = props.get("shape", {}).get("name", "?")
        value = props.get("value", {}).get("name", None)
        func = r.get("funcName", "top-level")
        print(f"  {r['varName']:20s} shape={shape:10s} value={value!s:15s} func={func}")

    # Assertions
    # 1. At least one loss record should have a 'value' property
    has_value = any(
        "value" in r.get("type", {}).get("properties", {})
        for r in loss_records
    )
    assert has_value, "FAIL: no loss record has a 'value' property"

    # 2. The value should be a reasonable float (cross-entropy on random init ~ 4.0)
    for r in loss_records:
        val_str = r["type"].get("properties", {}).get("value", {}).get("name")
        if val_str:
            val = float(val_str)
            print(f"\n  Loss value: {val}")
            assert 0.0 < val < 100.0, f"FAIL: loss value {val} out of reasonable range"
            break

    # 3. Check that large tensors DON'T have value (only scalars)
    logits_records = [r for r in records
                      if r.get("varName") == "logits"
                      and r.get("type", {}).get("class_name") == "Tensor"]
    for r in logits_records:
        props = r["type"].get("properties", {})
        assert "value" not in props, \
            f"FAIL: logits (non-scalar) should NOT have value, shape={props.get('shape', {}).get('name')}"

    print("  Non-scalar tensors correctly have no value property")

    shutil.rmtree(test_dir)
    print("\nPASS: Scalar tensor values captured!")


if __name__ == "__main__":
    main()
