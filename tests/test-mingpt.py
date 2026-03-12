"""Test: Trickle on Karpathy's minGPT (multi-file package structure).

Tests tracing across a proper Python package with imports between files:
- mingpt/model.py imports from mingpt/utils.py
- Entry script imports from mingpt package

This validates the import hook works with package-level imports.
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
sys.path.insert(0, "/tmp/minGPT")

import torch
from mingpt.model import GPT

# minGPT uses a CfgNode config system
config = GPT.get_default_config()
config.model_type = None  # custom config
config.block_size = 32
config.vocab_size = 64
config.n_layer = 2
config.n_head = 2
config.n_embd = 32

model = GPT(config)

# Forward pass
idx = torch.randint(0, 64, (2, 16))
targets = torch.randint(0, 64, (2, 16))
logits, loss = model(idx, targets)
print(f"minGPT loss: {loss.item():.4f}")
print("MINGPT_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_mingpt_")
    test_file = os.path.join(test_dir, "test_mingpt.py")
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

    if result.returncode != 0 or "MINGPT_OK" not in result.stdout:
        print(f"FAIL: exit code {result.returncode}")
        print("STDOUT:", result.stdout[:1000])
        print("STDERR:", result.stderr[:3000])
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    print("=== minGPT Multi-File Test ===\n")

    # Split by file
    model_records = [r for r in records if "model.py" in r.get("file", "")]
    utils_records = [r for r in records if "utils.py" in r.get("file", "")]
    entry_records = [r for r in records if "model.py" not in r.get("file", "") and "utils.py" not in r.get("file", "")]

    print(f"  Total records: {len(records)}")
    print(f"  model.py records: {len(model_records)}")
    print(f"  utils.py records: {len(utils_records)}")
    print(f"  Entry script records: {len(entry_records)}")

    # Check funcName coverage
    func_names = sorted(set(r.get("funcName", "") for r in model_records if r.get("funcName")))
    print(f"\n  Functions traced in model.py ({len(func_names)}):")
    for fn in func_names:
        count = sum(1 for r in model_records if r.get("funcName") == fn)
        print(f"    {fn:40s} ({count} records)")

    # --- Assertions ---

    # 1. Must have traces from model.py
    assert len(model_records) > 0, "FAIL: no model.py records"

    # 2. Must have GPT.forward traced
    assert any("GPT" in fn and "forward" in fn for fn in func_names), \
        f"FAIL: GPT.forward not traced. Got: {func_names}"

    # 3. Must have CausalSelfAttention.forward traced
    assert any("CausalSelfAttention" in fn and "forward" in fn for fn in func_names), \
        f"FAIL: CausalSelfAttention.forward not traced. Got: {func_names}"

    # 4. Check tensor shape flow in attention
    csa_tensors = [r for r in model_records
                   if r.get("funcName") == "CausalSelfAttention.forward"
                   and r.get("type", {}).get("class_name") == "Tensor"]
    print(f"\n  CausalSelfAttention.forward tensors: {len(csa_tensors)}")
    by_var = {}
    for r in csa_tensors:
        vn = r["varName"]
        if vn not in by_var:
            by_var[vn] = []
        by_var[vn].append(r)
    for vn, recs in sorted(by_var.items()):
        shapes = [r["type"]["properties"].get("shape", {}).get("name", "?")
                  for r in sorted(recs, key=lambda r: r["line"])]
        flow = " -> ".join(shapes) if len(shapes) > 1 else shapes[0]
        print(f"    {vn:10s}: {flow}")

    # 5. Check loss value captured
    loss_records = [r for r in records
                    if r.get("varName") == "loss"
                    and r.get("type", {}).get("class_name") == "Tensor"]
    has_loss_value = any("value" in r.get("type", {}).get("properties", {}) for r in loss_records)
    assert has_loss_value, "FAIL: loss value not captured"
    for r in loss_records:
        val = r["type"].get("properties", {}).get("value", {}).get("name")
        if val:
            print(f"\n  Loss value: {val}")
            break

    # 6. Check nn.Module detection
    module_records = [r for r in model_records
                      if r.get("varName", "").startswith("self.")
                      and r.get("type", {}).get("class_name")]
    module_types = sorted(set(r["type"]["class_name"] for r in module_records))
    print(f"\n  nn.Module types detected: {module_types}")
    assert "Linear" in module_types, "FAIL: Linear not detected"

    # 7. Check tensor stats present
    tensors_with_stats = [r for r in model_records
                          if r.get("type", {}).get("class_name") == "Tensor"
                          and "min" in r.get("type", {}).get("properties", {})]
    print(f"  Tensors with stats: {len(tensors_with_stats)}")
    assert len(tensors_with_stats) > 0, "FAIL: no tensor stats"

    # 8. Check return traces
    return_records = [r for r in model_records if r.get("varName", "").startswith("<return")]
    return_funcs = sorted(set(r.get("funcName", "?") for r in return_records))
    print(f"  Return traces from: {return_funcs}")

    shutil.rmtree(test_dir)
    print("\nPASS: minGPT multi-file test works!")


if __name__ == "__main__":
    main()
