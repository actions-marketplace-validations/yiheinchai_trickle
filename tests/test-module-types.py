"""Test: nn.Module type inference shows layer configurations.

Verifies that nn.Module instances like nn.Linear, nn.LayerNorm, nn.Embedding
are properly detected and their key attributes (in_features, out_features, etc.)
are captured — not misclassified as 'function:anonymous'.

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

# Forward pass to trigger traces in forward() too
x = torch.randint(0, 64, (2, 16))
y = torch.randint(0, 64, (2, 16))
logits, loss = model(x, y)
print("MODULE_TYPES_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_module_test_")
    test_file = os.path.join(test_dir, "test_modules.py")
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

    if result.returncode != 0 or "MODULE_TYPES_OK" not in result.stdout:
        print(f"FAIL: exit code {result.returncode}")
        print(result.stderr[:3000])
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    # Find nn.Module self.* attributes from model.py
    model_attrs = [r for r in records
                   if "model.py" in r.get("file", "")
                   and r.get("varName", "").startswith("self.")]

    print("=== nn.Module Type Inference ===\n")

    # Check specific layers
    modules_found = {}
    for r in model_attrs:
        name = r["varName"]
        type_node = r.get("type", {})
        class_name = type_node.get("class_name", "")
        props = type_node.get("properties", {})

        if class_name:
            prop_strs = []
            for k, v in props.items():
                prop_strs.append(f"{k}={v.get('name', '?')}")
            display = f"{class_name}({', '.join(prop_strs)})" if prop_strs else class_name
            modules_found[name] = display
            print(f"  {name:30s} → {display}")

    # Assertions
    # 1. self.c_attn should be Linear, NOT function:anonymous
    assert "self.c_attn" in modules_found, "FAIL: self.c_attn not found"
    assert "Linear" in modules_found["self.c_attn"], \
        f"FAIL: self.c_attn should be Linear, got: {modules_found['self.c_attn']}"

    # 2. Linear should have in_features and out_features
    c_attn_record = next(r for r in model_attrs if r["varName"] == "self.c_attn")
    c_attn_props = c_attn_record["type"]["properties"]
    assert "in_features" in c_attn_props, "FAIL: Linear missing in_features"
    assert "out_features" in c_attn_props, "FAIL: Linear missing out_features"
    # nanoGPT: c_attn = nn.Linear(n_embd, 3*n_embd) → in=32, out=96
    in_f = c_attn_props["in_features"]["name"]
    out_f = c_attn_props["out_features"]["name"]
    print(f"\n  self.c_attn: in_features={in_f}, out_features={out_f}")
    assert in_f == "32", f"FAIL: expected in_features=32, got {in_f}"
    assert out_f == "96", f"FAIL: expected out_features=96, got {out_f}"

    # 3. self.ln_1 should be LayerNorm
    assert "self.ln_1" in modules_found, "FAIL: self.ln_1 not found"
    assert "LayerNorm" in modules_found["self.ln_1"], \
        f"FAIL: self.ln_1 should be LayerNorm, got: {modules_found['self.ln_1']}"

    # 4. LayerNorm should be detected as a module class (not function)
    ln1_record = next(r for r in model_attrs if r["varName"] == "self.ln_1")
    ln1_type = ln1_record["type"]
    assert ln1_type.get("class_name") == "LayerNorm", \
        f"FAIL: self.ln_1 should be LayerNorm class, got: {ln1_type}"
    print(f"  self.ln_1: class_name=LayerNorm, props={list(ln1_type.get('properties', {}).keys())}")

    # 5. self.lm_head should be Linear with vocab_size output
    assert "self.lm_head" in modules_found, "FAIL: self.lm_head not found"
    lm_record = next(r for r in model_attrs if r["varName"] == "self.lm_head")
    lm_props = lm_record["type"]["properties"]
    lm_out = lm_props.get("out_features", {}).get("name", "?")
    print(f"  self.lm_head: out_features={lm_out} (should be 64 = vocab_size)")
    assert lm_out == "64", f"FAIL: lm_head out_features should be 64, got {lm_out}"

    # 6. Should have param counts
    has_params = any("params" in r.get("type", {}).get("properties", {}) for r in model_attrs)
    assert has_params, "FAIL: no param counts captured for nn.Module instances"

    # 7. No nn.Module should be classified as "function:anonymous"
    func_anon = [r for r in model_attrs
                 if r.get("type", {}).get("kind") == "function"
                 and r.get("type", {}).get("name") == "anonymous"]
    assert len(func_anon) == 0, \
        f"FAIL: {len(func_anon)} attrs still classified as function:anonymous: " + \
        str([r["varName"] for r in func_anon])

    print(f"\n  Total nn.Module attrs: {len(modules_found)}")
    print(f"  function:anonymous: 0 (was all of them before!)")

    shutil.rmtree(test_dir)
    print("\nPASS: nn.Module type inference works!")


if __name__ == "__main__":
    main()
