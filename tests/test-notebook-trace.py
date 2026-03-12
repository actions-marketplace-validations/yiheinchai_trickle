"""Test: Jupyter/IPython notebook variable tracing.

Simulates IPython cell execution with the trickle AST transformer
to verify that variable tracing works in notebook environments.
"""

import ast
import json
import os
import shutil
import sys
import tempfile


def main():
    # Add trickle to path
    trickle_src = os.path.join(os.path.dirname(__file__), "..", "packages", "client-python", "src")
    if trickle_src not in sys.path:
        sys.path.insert(0, trickle_src)

    test_dir = tempfile.mkdtemp(prefix="trickle_notebook_test_")
    trickle_dir = os.path.join(test_dir, ".trickle")
    os.environ["TRICKLE_LOCAL_DIR"] = trickle_dir
    os.environ["TRICKLE_TRACE_IMPORTS"] = "0"  # Don't install import hook in test

    print(f"Test dir: {test_dir}")

    try:
        from trickle.notebook import (
            _TrickleCellTransformer,
            _trickle_tv,
            _get_vars_file,
            _tv_cache,
            _extract_names,
        )

        transformer = _TrickleCellTransformer()

        # --- Cell 1: Basic tensor operations ---
        cell1_source = """
import torch
x = torch.randn(4, 8, 32)
y = torch.zeros(4, 8, 32)
z = x + y
"""
        print("=== Cell 1: Basic tensor operations ===")
        _run_cell(cell1_source, 1, transformer, _trickle_tv)

        # --- Cell 2: Training-like loop ---
        cell2_source = """
import torch
batches = [(torch.randn(8, 3, 8, 8), torch.randint(0, 10, (8,))) for _ in range(4)]
weight = torch.randn(10, 192)
for epoch in range(2):
    for batch_idx, (data, target) in enumerate(batches):
        flat = data.reshape(data.shape[0], -1)
        logits = flat @ weight.T
"""
        print("\n=== Cell 2: Training loop ===")
        _run_cell(cell2_source, 2, transformer, _trickle_tv)

        # --- Cell 3: Destructuring ---
        cell3_source = """
import torch
a, b = torch.randn(3, 3), torch.randn(3, 3)
result = a @ b
"""
        print("\n=== Cell 3: Destructuring ===")
        _run_cell(cell3_source, 3, transformer, _trickle_tv)

        # --- Verify variables.jsonl ---
        vars_file = _get_vars_file()
        if not os.path.exists(vars_file):
            print(f"\nFAIL: {vars_file} not found")
            sys.exit(1)

        with open(vars_file) as f:
            lines = f.readlines()

        print(f"\n=== TRACED VARIABLES ({len(lines)} entries) ===")

        all_records = []
        for line in lines:
            record = json.loads(line)
            all_records.append(record)

        all_var_names = {r["varName"] for r in all_records}
        tensor_records = [r for r in all_records if r.get("type", {}).get("class_name") in ("Tensor", "ndarray")]
        tensor_var_names = {r["varName"] for r in tensor_records}

        print(f"All variables: {sorted(all_var_names)}")
        print(f"Tensor variables: {sorted(tensor_var_names)}")

        for r in tensor_records:
            shape = r.get("type", {}).get("properties", {}).get("shape", {}).get("name", "?")
            cell = r.get("module", "?")
            print(f"  {r['varName']:15s} {cell:10s} line {r['line']:3d}  shape={shape}")

        # Assertions
        # Cell 1 tensors
        assert "x" in tensor_var_names, "FAIL: 'x' not traced"
        assert "y" in tensor_var_names, "FAIL: 'y' not traced"
        assert "z" in tensor_var_names, "FAIL: 'z' not traced"

        # Cell 2 for-loop variables
        assert "data" in tensor_var_names, "FAIL: 'data' from for-loop not traced"
        assert "target" in tensor_var_names, "FAIL: 'target' from for-loop not traced"
        assert "epoch" in all_var_names, "FAIL: 'epoch' from for-loop not traced"
        assert "batch_idx" in all_var_names, "FAIL: 'batch_idx' from for-loop not traced"
        assert "flat" in tensor_var_names, "FAIL: 'flat' not traced"
        assert "logits" in tensor_var_names, "FAIL: 'logits' not traced"

        # Cell 3 destructuring
        assert "a" in tensor_var_names, "FAIL: 'a' not traced"
        assert "b" in tensor_var_names, "FAIL: 'b' not traced"
        assert "result" in tensor_var_names, "FAIL: 'result' not traced"

        # Check cell indices are recorded
        cell1_records = [r for r in all_records if r.get("module") == "cell_1"]
        cell2_records = [r for r in all_records if r.get("module") == "cell_2"]
        cell3_records = [r for r in all_records if r.get("module") == "cell_3"]
        print(f"\nCell 1: {len(cell1_records)} vars, Cell 2: {len(cell2_records)} vars, Cell 3: {len(cell3_records)} vars")

        assert len(cell1_records) >= 3, f"FAIL: Cell 1 should have >=3 vars, got {len(cell1_records)}"
        assert len(cell2_records) >= 4, f"FAIL: Cell 2 should have >=4 vars, got {len(cell2_records)}"
        assert len(cell3_records) >= 3, f"FAIL: Cell 3 should have >=3 vars, got {len(cell3_records)}"

        # Check tensor shapes
        x_records = [r for r in tensor_records if r["varName"] == "x"]
        if x_records:
            shape = x_records[0]["type"]["properties"]["shape"]["name"]
            assert "[4, 8, 32]" in shape, f"FAIL: x shape should be [4, 8, 32], got {shape}"
            print(f"\nx shape: {shape} ✓")

        data_records = [r for r in tensor_records if r["varName"] == "data"]
        if data_records:
            shape = data_records[0]["type"]["properties"]["shape"]["name"]
            assert "[8, 3, 8, 8]" in shape, f"FAIL: data shape should be [8, 3, 8, 8], got {shape}"
            print(f"data shape: {shape} ✓")

        print(f"\nOK: {len(all_records)} variables traced across 3 cells, {len(tensor_records)} tensors")

    finally:
        shutil.rmtree(test_dir)
        os.environ.pop("TRICKLE_LOCAL_DIR", None)
        os.environ.pop("TRICKLE_TRACE_IMPORTS", None)

    print("\nPASS: Notebook variable tracing works!")


def _run_cell(source: str, cell_idx: int, transformer, tv_func):
    """Simulate running a notebook cell with AST transformation."""
    from trickle.notebook import _TrickleCellTransformer, _make_cell_id

    cell_id = _make_cell_id(cell_idx)

    # Parse the cell source
    tree = ast.parse(source.strip())

    # Transform it
    transformed = transformer.transform(tree, cell_idx, cell_id)

    # Compile and execute
    code = compile(transformed, f"<cell_{cell_idx}>", "exec")

    # Create a namespace with the tracer
    ns = {"_trickle_tv": tv_func}
    exec(code, ns)

    # Show what was traced
    var_names = [k for k in ns.keys() if not k.startswith("_") and k != "torch"]
    print(f"  Cell {cell_idx} executed. Namespace vars: {sorted(var_names)}")


if __name__ == "__main__":
    main()
