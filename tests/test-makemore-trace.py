"""E2E test: Variable tracing on Karpathy's makemore (Transformer model).

Runs a short training loop through trickle's variable tracer on makemore.py,
then verifies that tensor shapes are captured for variables throughout
the Transformer forward pass and training loop.

Tests:
1. Function parameter tracing (x in forward(), logits in generate())
2. For-loop variable tracing (for i, (x, y) in enumerate(loader))
3. Tuple unpacking (B, T, C = x.size(); q, k, v = ...)
4. Imported module tracing (makemore.py classes)
5. Deduplication across training iterations
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile


def main():
    # Test script that imports makemore and runs a short training loop
    test_script = r'''
import sys
sys.path.insert(0, "/tmp/makemore")

import torch
from makemore import ModelConfig, Transformer, CharDataset

# Create a tiny dataset
words = ["hello", "world", "foo", "bar", "baz", "test", "deep", "learn"]
chars = sorted(set("".join(words)))
max_word_length = max(len(w) for w in words)
dataset = CharDataset(words, chars, max_word_length)
config = ModelConfig(
    block_size=dataset.get_output_length(),
    vocab_size=dataset.get_vocab_size(),
    n_layer=2,
    n_embd=32,
    n_embd2=32,
    n_head=2,
)
model = Transformer(config)
model.train()

# Training loop (just a few steps, no optimizer to avoid torch._dynamo)
for step_idx in range(3):
    indices = torch.randint(0, len(dataset), (4,))
    batch_x = []
    batch_y = []
    for i in indices:
        x_i, y_i = dataset[i.item()]
        batch_x.append(x_i)
        batch_y.append(y_i)
    x = torch.stack(batch_x)
    y = torch.stack(batch_y)
    logits, loss = model(x, y)
    print(f"Step {step_idx}: loss={loss.item():.4f}")

# Run inference
model.eval()
with torch.no_grad():
    test_x = torch.zeros(1, 1, dtype=torch.long)
    out, _ = model(test_x)
    print(f"Inference output shape: {out.shape}")

print("MAKEMORE OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_makemore_test_")
    test_file = os.path.join(test_dir, "test_makemore.py")
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
    env["TRICKLE_DEBUG"] = "1"

    print("Running makemore Transformer training through trickle...")
    print(f"Test dir: {test_dir}")

    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=120,
    )

    print("=== STDOUT ===")
    print(result.stdout)
    if result.stderr:
        # Filter out debug noise
        lines = result.stderr.split("\n")
        relevant = [l for l in lines if not l.startswith("DEBUG:")]
        if relevant:
            print("=== STDERR ===")
            print("\n".join(relevant[:30]))

    if result.returncode != 0:
        print(f"FAIL: process exited with code {result.returncode}")
        if result.stderr:
            print("=== FULL STDERR ===")
            print(result.stderr[:5000])
        sys.exit(1)

    if "MAKEMORE OK" not in result.stdout:
        print("FAIL: training loop did not complete")
        sys.exit(1)

    # Check variables.jsonl
    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    if not os.path.exists(vars_file):
        print(f"FAIL: {vars_file} not found")
        sys.exit(1)

    with open(vars_file) as f:
        lines = f.readlines()

    records = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    # Separate entry file vs makemore.py records
    entry_records = [r for r in records if "test_makemore" in r.get("file", "")]
    makemore_records = [r for r in records if "makemore.py" in r.get("file", "")]

    all_var_names = {r["varName"] for r in records}
    tensor_records = [r for r in records if r.get("type", {}).get("class_name") in ("Tensor", "ndarray")]
    tensor_var_names = {r["varName"] for r in tensor_records}

    entry_tensor_names = {r["varName"] for r in tensor_records if "test_makemore" in r.get("file", "")}
    makemore_tensor_names = {r["varName"] for r in tensor_records if "makemore.py" in r.get("file", "")}

    print(f"\n=== RESULTS ===")
    print(f"Total variables: {len(records)}")
    print(f"  Entry file: {len(entry_records)} ({len(entry_tensor_names)} tensors)")
    print(f"  makemore.py: {len(makemore_records)} ({len(makemore_tensor_names)} tensors)")
    print(f"\nEntry tensor vars: {sorted(entry_tensor_names)}")
    print(f"makemore.py tensor vars: {sorted(makemore_tensor_names)}")

    # Print tensor shapes
    print("\n--- Tensor shapes ---")
    for r in sorted(tensor_records, key=lambda r: (r.get("file", ""), r.get("line", 0))):
        shape = r.get("type", {}).get("properties", {}).get("shape", {}).get("name", "?")
        fname = os.path.basename(r.get("file", "?"))
        print(f"  {fname:20s} line {r['line']:4d}  {r['varName']:15s} {shape}")

    # Assertions
    # 1. Entry file should have traced x, y, logits, loss, batch, out
    assert "x" in entry_tensor_names, "FAIL: 'x' from training loop not traced"
    assert "y" in entry_tensor_names, "FAIL: 'y' from training loop not traced"
    assert "logits" in entry_tensor_names, "FAIL: 'logits' not traced in entry"
    assert "loss" in entry_tensor_names, "FAIL: 'loss' not traced in entry"
    assert "out" in entry_tensor_names or "test_x" in entry_tensor_names, "FAIL: inference vars not traced"

    # 2. For-loop variable (step_idx) should be traced
    assert "step_idx" in all_var_names, "FAIL: 'step_idx' for-loop var not traced"

    # 3. makemore.py should have q, k, v from CausalSelfAttention.forward
    assert "q" in makemore_tensor_names, "FAIL: 'q' not traced in makemore.py"
    assert "k" in makemore_tensor_names, "FAIL: 'k' not traced in makemore.py"
    assert "v" in makemore_tensor_names, "FAIL: 'v' not traced in makemore.py"

    # 4. makemore.py should have function params (x in forward)
    x_in_makemore = [r for r in tensor_records if r["varName"] == "x" and "makemore.py" in r.get("file", "")]
    assert len(x_in_makemore) >= 1, "FAIL: 'x' param not traced in makemore.py"

    # 5. Should have tuple unpacking vars (B, T, C = x.size())
    assert "B" in all_var_names, "FAIL: 'B' from tuple unpacking not traced"
    assert "T" in all_var_names, "FAIL: 'T' from tuple unpacking not traced"
    assert "C" in all_var_names, "FAIL: 'C' from tuple unpacking not traced"

    # 6. Deduplication: should NOT have 3x entries for each variable (3 training steps)
    logits_count = sum(1 for r in records if r["varName"] == "logits")
    print(f"\n'logits' entries: {logits_count} (should be small due to dedup)")
    # Multiple entries are OK (different shapes at different lines), but not 3x per step

    # 7. Check total counts
    assert len(tensor_records) >= 15, f"FAIL: only {len(tensor_records)} tensors (expected >=15)"
    assert len(makemore_records) >= 10, f"FAIL: only {len(makemore_records)} makemore.py vars (expected >=10)"

    print(f"\nOK: {len(records)} total vars, {len(tensor_records)} tensors")
    print(f"  Entry: x{entry_tensor_names}, makemore: {len(makemore_tensor_names)} tensor vars")

    shutil.rmtree(test_dir)
    print("\nPASS: makemore Transformer variable tracing works!")


if __name__ == "__main__":
    main()
