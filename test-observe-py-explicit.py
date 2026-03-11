"""Quick test: explicit observe() API."""
import sys
import os

# Add trickle to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "packages", "client-python", "src"))
sys.path.insert(0, os.path.dirname(__file__))

from trickle import observe, observe_fn, configure

configure(backend_url="http://localhost:4888")

import test_observe_py_helpers as raw_helpers

# Wrap all helpers
helpers = observe(raw_helpers, module="py-helpers")

print("Testing explicit observe()...")

config = helpers.parse_config({"host": "test.com", "port": 9090})
print(f"  parse_config → {config}")

items = helpers.process_items([{"id": 1, "name": "foo"}, {"id": 2, "name": "bar"}])
print(f"  process_items → {len(items)} items")

stats = helpers.calculate_stats([1, 2, 3, 4, 5])
print(f"  calculate_stats → avg={stats['avg']}")

merged = helpers.merge_records(
    [{"id": 1, "name": "A"}],
    [{"id": 1, "email": "a@b.com"}, {"id": 2, "name": "B"}],
)
print(f"  merge_records → {len(merged)} records")

try:
    helpers.failing_function("bad")
except ValueError as e:
    print(f"  failing_function → error: {e}")

# Also test observe_fn
traced = observe_fn(raw_helpers.calculate_stats, module="standalone", name="calc_stats")
result = traced([100, 200, 300])
print(f"  observe_fn → avg={result['avg']}")

# Wait for flush
import time
time.sleep(3)

print("Done! Check trickle functions.")
