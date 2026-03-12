"""Test: Tensor statistics (min/max/mean) in type inference.

Verifies that non-scalar floating-point tensors include min, max, and mean
statistics in their type properties for hover display.

Tests on nanoGPT to verify real-world values are captured.
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
print("STATS_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_stats_")
    test_file = os.path.join(test_dir, "test_stats.py")
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

    if result.returncode != 0 or "STATS_OK" not in result.stdout:
        print(f"FAIL: exit code {result.returncode}")
        print(result.stderr[:3000])
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    print("=== Tensor Statistics ===\n")

    # Find float tensor records from model.py with stats
    model_tensors = [r for r in records
                     if "model.py" in r.get("file", "")
                     and r.get("type", {}).get("class_name") == "Tensor"
                     and "min" in r.get("type", {}).get("properties", {})]

    print(f"  Tensors with stats: {len(model_tensors)}")

    # Show a few examples
    for r in model_tensors[:8]:
        props = r["type"]["properties"]
        shape = props.get("shape", {}).get("name", "?")
        mn = props.get("min", {}).get("name", "?")
        mx = props.get("max", {}).get("name", "?")
        mean = props.get("mean", {}).get("name", "?")
        func = r.get("funcName", "?")
        print(f"  {r['varName']:15s} {shape:20s} min={mn:10s} max={mx:10s} mean={mean:10s} ({func})")

    # Assertions
    assert len(model_tensors) > 0, "FAIL: no tensors have min/max/mean stats"

    # Check that stats have reasonable values (not all zeros, not insane)
    for r in model_tensors[:5]:
        props = r["type"]["properties"]
        mn = float(props["min"]["name"])
        mx = float(props["max"]["name"])
        mean_val = float(props["mean"]["name"])
        assert mn <= mean_val <= mx, \
            f"FAIL: stats inconsistent for {r['varName']}: min={mn}, mean={mean_val}, max={mx}"

    print("\n  Stats are consistent (min <= mean <= max)")

    # Check that scalar tensors do NOT have stats (they have value instead)
    loss_records = [r for r in records
                    if r.get("varName") == "loss"
                    and r.get("type", {}).get("class_name") == "Tensor"]
    for r in loss_records:
        props = r["type"].get("properties", {})
        if "value" in props:
            assert "min" not in props, "FAIL: scalar tensor should not have min/max/mean"
            print(f"\n  loss (scalar): value={props['value']['name']}, no stats (correct)")
            break

    # Check that integer tensors do NOT have stats
    int_tensors = [r for r in records
                   if r.get("type", {}).get("class_name") == "Tensor"
                   and "int" in r.get("type", {}).get("properties", {}).get("dtype", {}).get("name", "")]
    for r in int_tensors[:1]:
        props = r["type"].get("properties", {})
        assert "min" not in props, f"FAIL: int tensor {r['varName']} should not have stats"
        print(f"  {r['varName']} (int tensor): no stats (correct)")

    shutil.rmtree(test_dir)
    print("\nPASS: Tensor statistics captured!")


if __name__ == "__main__":
    main()
