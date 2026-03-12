"""Test: function parameter tracing.

Verifies that function parameters (especially tensor inputs to model
forward methods) are traced at function entry. This is critical for
debugging shape mismatches in ML code.
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

class SimpleModel:
    def forward(self, x, mask=None):
        """x and mask should be traced as function params."""
        h = x @ torch.randn(x.shape[-1], 16)
        if mask is not None:
            h = h * mask
        return h

    def compute_loss(self, logits, targets):
        """logits and targets should be traced."""
        diff = logits - targets
        return (diff ** 2).mean()

def process_batch(data, labels, model):
    """data and labels should be traced."""
    output = model.forward(data)
    loss = model.compute_loss(output, labels[:, :output.shape[1]])
    return loss

# Also test functions with *args, **kwargs, keyword-only args
def flexible_fn(x, y, *extra, scale=1.0, **opts):
    return x * scale + y

model = SimpleModel()
batch_x = torch.randn(4, 8, 32)
batch_y = torch.randn(4, 8, 16)
batch_mask = torch.ones(4, 8, 16)

# Call the chain
loss = process_batch(batch_x, batch_y, model)
out_masked = model.forward(batch_x, mask=batch_mask)
result = flexible_fn(torch.tensor(1.0), torch.tensor(2.0), scale=3.0)

print(f"loss shape: {loss.shape}")
print(f"out_masked shape: {out_masked.shape}")
print("PARAM TRACE OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_param_test_")
    test_file = os.path.join(test_dir, "test_params.py")
    with open(test_file, "w") as f:
        f.write(test_script)

    trickle_dir = os.path.join(test_dir, ".trickle")
    python = sys.executable
    trickle_src = os.path.join(os.path.dirname(__file__), "packages", "client-python", "src")

    env = os.environ.copy()
    env["PYTHONPATH"] = trickle_src + (os.pathsep + env.get("PYTHONPATH", ""))
    env["TRICKLE_LOCAL"] = "1"
    env["TRICKLE_LOCAL_DIR"] = trickle_dir
    env["TRICKLE_TRACE_VARS"] = "1"

    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=60,
    )

    print("=== STDOUT ===")
    print(result.stdout)
    if result.stderr:
        print("=== STDERR ===")
        print(result.stderr[:2000])

    if result.returncode != 0:
        print(f"FAIL: exit code {result.returncode}")
        sys.exit(1)

    if "PARAM TRACE OK" not in result.stdout:
        print("FAIL: script did not complete")
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    all_var_names = {r["varName"] for r in records}
    tensor_names = {r["varName"] for r in records if r.get("type", {}).get("class_name") == "Tensor"}

    print(f"\n=== TRACED ({len(records)} entries) ===")
    print(f"All: {sorted(all_var_names)}")
    print(f"Tensors: {sorted(tensor_names)}")

    for r in records:
        if r.get("type", {}).get("class_name") == "Tensor":
            shape = r["type"]["properties"]["shape"]["name"]
            print(f"  {r['varName']:15s} line {r['line']:3d}  shape={shape}")

    # KEY: function parameters must be traced
    # forward(self, x, mask=None)
    assert "x" in tensor_names, "FAIL: 'x' param of forward() not traced"
    assert "mask" in tensor_names, "FAIL: 'mask' param of forward() not traced"

    # compute_loss(self, logits, targets)
    assert "logits" in tensor_names, "FAIL: 'logits' param not traced"
    assert "targets" in tensor_names, "FAIL: 'targets' param not traced"

    # process_batch(data, labels, model)
    assert "data" in tensor_names, "FAIL: 'data' param not traced"
    assert "labels" in tensor_names, "FAIL: 'labels' param not traced"

    # flexible_fn(x, y, *extra, scale=1.0, **opts)
    assert "scale" in all_var_names, "FAIL: 'scale' kwonly param not traced"

    # Check x has the right shape (param to forward, called with batch_x[4,8,32])
    x_records = [r for r in records if r["varName"] == "x" and r.get("type", {}).get("class_name") == "Tensor"]
    assert len(x_records) >= 1, "FAIL: no tensor record for x"
    x_shape = x_records[0]["type"]["properties"]["shape"]["name"]
    assert "[4, 8, 32]" in x_shape, f"FAIL: x shape should be [4, 8, 32], got {x_shape}"
    print(f"\nx param shape: {x_shape} ✓")

    # Check data has the right shape
    data_records = [r for r in records if r["varName"] == "data" and r.get("type", {}).get("class_name") == "Tensor"]
    assert len(data_records) >= 1
    data_shape = data_records[0]["type"]["properties"]["shape"]["name"]
    assert "[4, 8, 32]" in data_shape, f"FAIL: data shape should be [4, 8, 32], got {data_shape}"
    print(f"data param shape: {data_shape} ✓")

    shutil.rmtree(test_dir)
    print(f"\nPASS: Function parameter tracing works! ({len(records)} vars traced)")


if __name__ == "__main__":
    main()
