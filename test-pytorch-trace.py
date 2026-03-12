"""E2E test: Python variable tracing with tensor shapes on nanoGPT.

Runs a small GPT model forward pass through trickle's variable tracer,
then verifies that .trickle/variables.jsonl contains tensor shape info
for variables in both the entry script AND imported modules (model.py).

Tests both:
1. Entry file tracing (via _entry_transform.py AST rewriting)
2. Imported module tracing (via _trace_import_hook.py meta_path hook)
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile


def main():
    # Create a self-contained test script that imports nanoGPT model and runs a forward pass
    test_script = r'''
import sys
sys.path.insert(0, "/tmp/nanoGPT")

import torch
from model import GPTConfig, GPT

# Create a small GPT model for testing
config = GPTConfig(
    block_size=64,
    vocab_size=256,
    n_layer=2,
    n_head=2,
    n_embd=32,
    dropout=0.0,
    bias=True,
)
model = GPT(config)
model.eval()

# Create dummy input
idx = torch.randint(0, 256, (1, 16))  # batch=1, seq_len=16
targets = torch.randint(0, 256, (1, 16))

# Forward pass — this should trace all variable assignments
logits, loss = model(idx, targets)

print(f"logits shape: {logits.shape}")
print(f"loss: {loss.item():.4f}")

# Test a function with intermediate tensor operations
def attention_debug(x, n_head):
    """Simulate attention computation to test variable tracing inside functions."""
    B, T, C = x.size()
    head_size = C // n_head
    q = x[:, :, :C//2]
    k = x[:, :, C//2:]
    att = q @ k.transpose(-2, -1) * (1.0 / (head_size ** 0.5))
    att = torch.softmax(att, dim=-1)
    result = att @ x[:, :, :C//2]
    return result

test_input = torch.randn(1, 8, 32)
output = attention_debug(test_input, n_head=2)
print(f"attention_debug output shape: {output.shape}")

# Also test generate
with torch.no_grad():
    generated = model.generate(idx[:, :8], max_new_tokens=4)
    print(f"generated shape: {generated.shape}")

print("FORWARD PASS OK")
'''

    # Write test script to a temp file
    test_dir = tempfile.mkdtemp(prefix="trickle_pytorch_test_")
    test_file = os.path.join(test_dir, "test_gpt.py")
    with open(test_file, "w") as f:
        f.write(test_script)

    # Clean up any old .trickle directory
    trickle_dir = os.path.join(test_dir, ".trickle")
    if os.path.exists(trickle_dir):
        shutil.rmtree(trickle_dir)

    # Run the test script through trickle's observe_runner (full pipeline)
    python = sys.executable
    trickle_src = os.path.join(os.path.dirname(__file__), "packages", "client-python", "src")

    env = os.environ.copy()
    env["PYTHONPATH"] = trickle_src + (os.pathsep + env.get("PYTHONPATH", ""))
    env["TRICKLE_LOCAL"] = "1"
    env["TRICKLE_LOCAL_DIR"] = trickle_dir
    env["TRICKLE_TRACE_VARS"] = "1"
    env["TRICKLE_DEBUG"] = "1"

    print(f"Running nanoGPT forward pass through trickle...")
    print(f"Test dir: {test_dir}")

    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    print("=== STDOUT ===")
    print(result.stdout)
    if result.stderr:
        print("=== STDERR ===")
        print(result.stderr[:3000])

    if result.returncode != 0:
        print(f"FAIL: process exited with code {result.returncode}")
        sys.exit(1)

    if "FORWARD PASS OK" not in result.stdout:
        print("FAIL: forward pass did not complete")
        sys.exit(1)

    # Check variables.jsonl
    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    if not os.path.exists(vars_file):
        print(f"FAIL: {vars_file} not found")
        sys.exit(1)

    with open(vars_file) as f:
        lines = f.readlines()

    print(f"\n=== TRACED VARIABLES ({len(lines)} entries) ===")

    tensor_vars = []
    all_vars = []
    for line in lines:
        record = json.loads(line)
        all_vars.append(record["varName"])
        type_node = record.get("type", {})
        class_name = type_node.get("class_name", "")
        if class_name in ("Tensor", "ndarray"):
            tensor_vars.append(record)
            shape = type_node.get("properties", {}).get("shape", {}).get("name", "?")
            dtype = type_node.get("properties", {}).get("dtype", {}).get("name", "?")
            device = type_node.get("properties", {}).get("device", {}).get("name", "?")
            print(f"  {record['varName']:20s} line {record['line']:4d}  shape={shape:30s}  dtype={dtype:20s}  device={device}")

    print(f"\nAll traced variables: {sorted(set(all_vars))}")

    if len(tensor_vars) == 0:
        print("FAIL: no tensor variables traced!")
        sys.exit(1)

    # Check that we got shape info for key ML variables
    tensor_var_names = {v["varName"] for v in tensor_vars}
    print(f"\nTensor variables found: {sorted(tensor_var_names)}")

    expected_some = {"idx", "logits", "loss", "targets"}
    found = expected_some & tensor_var_names
    print(f"Expected tensor vars found: {sorted(found)}")

    if len(found) < 2:
        print(f"FAIL: only found {len(found)} of expected tensor vars (expected >=2)")
        sys.exit(1)

    # Check that model.py (imported module) was also traced
    model_records = [r for r in lines if '"model.py"' in r or '/model.py"' in r]
    model_parsed = [json.loads(r) for r in model_records if r.strip()]
    model_tensors = [r for r in model_parsed if r.get("type", {}).get("class_name") == "Tensor"]
    print(f"\nmodel.py: {len(model_parsed)} total vars, {len(model_tensors)} tensors")

    # Should have q, k, v from CausalSelfAttention.forward
    model_tensor_names = {r["varName"] for r in model_tensors}
    expected_model = {"q", "k", "v", "x", "logits"}
    found_model = expected_model & model_tensor_names
    print(f"Expected model.py tensor vars found: {sorted(found_model)}")

    if len(model_tensors) < 5:
        print(f"FAIL: only {len(model_tensors)} tensor vars from model.py (expected >=5)")
        sys.exit(1)

    if len(found_model) < 3:
        print(f"FAIL: only found {len(found_model)} of expected model tensor vars")
        sys.exit(1)

    print(f"OK: {len(found)} entry vars + {len(model_tensors)} model.py tensors traced")

    # Clean up
    shutil.rmtree(test_dir)
    print("\nPASS: Python variable tracing with tensor shapes works!")


if __name__ == "__main__":
    main()
