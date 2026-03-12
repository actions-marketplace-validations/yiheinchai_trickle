"""Test: Trickle on Karpathy's makemore (multiple model architectures).

Tests tracing on Transformer, BoW, and RNN models to verify trickle
works across diverse ML architectures, not just nanoGPT.
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
sys.path.insert(0, "/tmp/makemore")

import torch
from makemore import ModelConfig, Transformer, BoW, RNN

# Setup config
config = ModelConfig(block_size=16, vocab_size=27, n_layer=2, n_embd=32, n_embd2=32, n_head=4)

# --- Test 1: Transformer model ---
transformer = Transformer(config)
idx = torch.randint(0, 27, (4, 16))  # batch=4, seq=16
targets = torch.randint(0, 27, (4, 16))
logits, loss = transformer(idx, targets)
print(f"Transformer loss: {loss.item():.4f}")

# --- Test 2: BoW model ---
bow = BoW(config)
logits_bow, loss_bow = bow(idx, targets)
print(f"BoW loss: {loss_bow.item():.4f}")

# --- Test 3: RNN model ---
rnn = RNN(config, cell_type='rnn')
logits_rnn, loss_rnn = rnn(idx, targets)
print(f"RNN loss: {loss_rnn.item():.4f}")

print("MAKEMORE_OK")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_makemore_")
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

    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=120,
    )

    if result.returncode != 0 or "MAKEMORE_OK" not in result.stdout:
        print(f"FAIL: exit code {result.returncode}")
        print("STDOUT:", result.stdout[:1000])
        print("STDERR:", result.stderr[:3000])
        sys.exit(1)

    vars_file = os.path.join(trickle_dir, "variables.jsonl")
    with open(vars_file) as f:
        records = [json.loads(l) for l in f if l.strip()]

    print("=== Makemore Multi-Model Test ===\n")

    # Split by file
    makemore_records = [r for r in records if "makemore.py" in r.get("file", "")]
    entry_records = [r for r in records if "makemore.py" not in r.get("file", "")]

    print(f"  Total records: {len(records)}")
    print(f"  makemore.py records: {len(makemore_records)}")
    print(f"  Entry script records: {len(entry_records)}")

    # Check funcName coverage
    func_names = sorted(set(r.get("funcName", "") for r in makemore_records if r.get("funcName")))
    print(f"\n  Functions traced ({len(func_names)}):")
    for fn in func_names:
        count = sum(1 for r in makemore_records if r.get("funcName") == fn)
        print(f"    {fn:40s} ({count} records)")

    # --- Assertions ---

    # 1. Must have traces from all 3 model architectures
    assert any("Transformer" in fn for fn in func_names), \
        f"FAIL: no Transformer functions traced. Got: {func_names}"
    assert any("BoW" in fn or "Bow" in fn or "CausalBoW" in fn for fn in func_names), \
        f"FAIL: no BoW functions traced. Got: {func_names}"
    assert any("RNN" in fn for fn in func_names), \
        f"FAIL: no RNN functions traced. Got: {func_names}"
    print("\n  All 3 architectures traced!")

    # 2. Check tensor shape flow in CausalSelfAttention.forward
    csa_tensors = [r for r in makemore_records
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
        shapes = [r["type"]["properties"].get("shape", {}).get("name", "?") for r in sorted(recs, key=lambda r: r["line"])]
        flow = " -> ".join(shapes) if len(shapes) > 1 else shapes[0]
        print(f"    {vn:10s}: {flow}")

    # 3. Check tuple unpacking (B, T, C = x.size())
    btc_vars = [r for r in makemore_records if r.get("varName") in ("B", "T", "C")]
    print(f"\n  B/T/C unpacking records: {len(btc_vars)}")
    # Note: B, T, C are integers from .size(), not traced because they start with uppercase
    # Actually they ARE valid var names. Let's check if they exist.

    # 4. Check nn.Module attributes (self.c_attn, etc.)
    attr_records = [r for r in makemore_records if r.get("varName", "").startswith("self.")]
    attr_classes = {}
    for r in attr_records:
        cls = r.get("type", {}).get("class_name", "")
        if cls:
            attr_classes[cls] = attr_classes.get(cls, 0) + 1
    print(f"\n  self.* attribute types:")
    for cls, count in sorted(attr_classes.items()):
        print(f"    {cls:20s}: {count}")

    # 5. Check loss values are captured (scalar tensors)
    loss_records = [r for r in records if r.get("varName") in ("loss", "loss_bow", "loss_rnn")]
    print(f"\n  Loss records: {len(loss_records)}")
    for r in loss_records:
        props = r["type"].get("properties", {})
        val = props.get("value", {}).get("name", "N/A")
        func = r.get("funcName", "top-level")
        print(f"    {r['varName']:10s}: value={val:10s} func={func}")

    assert len(loss_records) >= 3, \
        f"FAIL: expected at least 3 loss records (one per model), got {len(loss_records)}"

    # 6. Check no NaN/Inf in any tensor (normal training should be clean)
    nan_records = [r for r in records
                   if r.get("type", {}).get("properties", {}).get("nan_count")]
    inf_records = [r for r in records
                   if r.get("type", {}).get("properties", {}).get("inf_count")]
    print(f"\n  NaN tensors: {len(nan_records)}")
    print(f"  Inf tensors: {len(inf_records)}")

    # 7. Check return value traces
    return_records = [r for r in makemore_records if r.get("varName", "").startswith("<return")]
    return_funcs = sorted(set(r.get("funcName", "?") for r in return_records))
    print(f"\n  Return traces from: {return_funcs}")

    shutil.rmtree(test_dir)
    print("\nPASS: makemore multi-architecture test works!")


if __name__ == "__main__":
    main()
