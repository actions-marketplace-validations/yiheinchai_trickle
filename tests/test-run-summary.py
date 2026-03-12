"""Test: terminal summary printed after trickle run.

Verifies that running a PyTorch script via trickle's observe_runner
prints a tensor shape summary to stderr when the script completes.
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
import torch.nn as nn

class MiniModel(nn.Module):
    def __init__(self, in_dim, hidden, out_dim):
        super().__init__()
        self.fc1 = nn.Linear(in_dim, hidden)
        self.fc2 = nn.Linear(hidden, out_dim)
        self.relu = nn.ReLU()

    def forward(self, x):
        h = self.relu(self.fc1(x))
        out = self.fc2(h)
        return out

model = MiniModel(32, 64, 10)
x = torch.randn(8, 32)
output = model(x)
loss = nn.functional.cross_entropy(output, torch.randint(0, 10, (8,)))
loss.backward()
print(f"loss = {loss.item():.4f}")
'''

    test_dir = tempfile.mkdtemp(prefix="trickle_summary_test_")
    test_file = os.path.join(test_dir, "train.py")
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

    print("Running training script through trickle...")
    result = subprocess.run(
        [python, "-c", "from trickle.observe_runner import main; main()", test_file],
        cwd=test_dir, env=env, capture_output=True, text=True, timeout=60,
    )

    print("=== STDOUT ===")
    print(result.stdout)
    print("=== STDERR ===")
    print(result.stderr)

    if result.returncode != 0:
        print(f"FAIL: process exited with code {result.returncode}")
        sys.exit(1)

    stderr = result.stderr

    # Check that the summary header is present
    if "variables traced" not in stderr:
        print("FAIL: summary header not found in stderr")
        sys.exit(1)
    print("OK: summary header found")

    # Check that tensor shapes are shown
    if "Tensor" not in stderr:
        print("FAIL: no tensor shapes in summary")
        sys.exit(1)
    print("OK: tensor shapes in summary")

    # Check that variable names are shown
    has_vars = any(name in stderr for name in ["x", "output", "loss", "h"])
    if not has_vars:
        print("FAIL: no variable names in summary")
        sys.exit(1)
    print("OK: variable names in summary")

    # Check that file path is shown
    if "train.py" not in stderr:
        print("FAIL: file path not in summary")
        sys.exit(1)
    print("OK: file path in summary")

    # Check that function context is shown
    if "forward" not in stderr:
        print("FAIL: function context not in summary")
        sys.exit(1)
    print("OK: function context in summary")

    shutil.rmtree(test_dir)
    print("\nPASS: Terminal summary works!")


if __name__ == "__main__":
    main()
