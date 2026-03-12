"""Test: Attribute assignment tracing (self.x = ...) in ML model code.

Verifies that self.attr assignments in __init__ and forward methods
are traced with their types, so you can see layer configurations
and intermediate state by hovering over self.xxx in VSCode.

Tests on nanoGPT's model.py.
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

# Create a tiny GPT model
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
model.train()

# Forward pass
x = torch.randint(0, 64, (2, 16))
y = torch.randint(0, 64, (2, 16))
logits, loss = model(x, y)
print(f"logits: {logits.shape}, loss: {loss.item():.4f}")

print("ATTR_TRACE_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_attr_test_")
    test_file = os.path.join(test_dir, "test_attr.py")
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

    print("Running nanoGPT with attribute assignment tracing...")

    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=120,
    )

    print("=== STDOUT ===")
    print(result.stdout)
    if result.stderr:
        lines = result.stderr.split("\n")
        relevant = [l for l in lines if not l.startswith("DEBUG:")]
        if relevant:
            print("=== STDERR (non-debug) ===")
            print("\n".join(relevant[:20]))

    if result.returncode != 0:
        print(f"FAIL: process exited with code {result.returncode}")
        if result.stderr:
            print("=== FULL STDERR ===")
            print(result.stderr[:5000])
        sys.exit(1)

    if "ATTR_TRACE_OK" not in result.stdout:
        print("FAIL: did not complete")
        sys.exit(1)

    # Check variables.jsonl
    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    if not os.path.exists(vars_file):
        print(f"FAIL: {vars_file} not found")
        sys.exit(1)

    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    # Find attribute traces (varName contains ".")
    attr_records = [r for r in records if "." in r.get("varName", "")]
    self_records = [r for r in attr_records if r["varName"].startswith("self.")]
    model_self_records = [r for r in self_records if "model.py" in r.get("file", "")]

    all_var_names = sorted(set(r["varName"] for r in records))
    attr_var_names = sorted(set(r["varName"] for r in attr_records))
    model_attr_names = sorted(set(r["varName"] for r in model_self_records))

    print(f"\n=== ATTRIBUTE TRACING RESULTS ===")
    print(f"Total variables: {len(records)}")
    print(f"Attribute traces: {len(attr_records)} ({len(self_records)} self.*)")
    print(f"model.py self.* attrs: {len(model_self_records)}")
    print(f"\nAttribute var names: {attr_var_names}")
    print(f"model.py self.* names: {model_attr_names}")

    # Print details
    print("\n--- model.py self.* attribute details ---")
    for r in sorted(model_self_records, key=lambda r: r.get("line", 0)):
        line = r.get("line", 0)
        name = r.get("varName", "?")
        type_node = r.get("type", {})
        class_name = type_node.get("class_name", "")
        kind = type_node.get("kind", "")
        if class_name:
            print(f"  line {line:4d}  {name:30s} {class_name}")
        else:
            print(f"  line {line:4d}  {name:30s} {kind}:{type_node.get('name', '?')}")

    # Assertions
    # 1. Should have self.* attribute traces from model.py
    assert len(model_self_records) >= 3, f"FAIL: only {len(model_self_records)} self.* attrs in model.py (expected >=3)"

    # 2. GPT.__init__ should trace self.transformer (a ModuleDict)
    transformer_attrs = [r for r in model_self_records if "transformer" in r["varName"]]
    print(f"\nself.transformer* attrs: {[r['varName'] for r in transformer_attrs]}")

    # 3. Should have some self.* attributes from the model
    # nanoGPT sets: self.transformer, self.lm_head, self.config, etc.
    # CausalSelfAttention sets: self.c_attn, self.c_proj, self.attn_dropout, etc.
    has_model_attrs = any("lm" in r["varName"] or "config" in r["varName"] or "transformer" in r["varName"]
                        for r in model_self_records)
    assert has_model_attrs, "FAIL: no model architecture attrs traced (expected self.transformer, self.lm_head, etc.)"

    # 4. Forward pass intermediates should still work (existing functionality)
    tensor_records = [r for r in records if r.get("type", {}).get("class_name") == "Tensor"]
    assert len(tensor_records) >= 10, f"FAIL: only {len(tensor_records)} tensor records (expected >=10)"

    print(f"\nOK: {len(attr_records)} attribute traces, {len(model_self_records)} from model.py")
    print(f"Tensor records: {len(tensor_records)}")

    shutil.rmtree(test_dir)
    print("\nPASS: Attribute assignment tracing works!")


if __name__ == "__main__":
    main()
