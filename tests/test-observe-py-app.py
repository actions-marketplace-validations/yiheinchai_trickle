"""Test app that imports helpers and calls them.
Has ZERO trickle imports — relies on auto-observation via trickle run."""

import sys
import os

# Add project root to path so we can import the test helpers
sys.path.insert(0, os.path.dirname(__file__))

# These imports will be intercepted by the observe hook
from test_observe_py_helpers import (
    parse_config,
    process_items,
    calculate_stats,
    merge_records,
    failing_function,
)


def main():
    print("Starting Python test app...")

    config = parse_config({"host": "api.example.com", "port": 8080, "debug": True})
    print(f"Config: {config}")

    items = process_items([
        {"id": 1, "name": "widget"},
        {"id": 2, "name": "gadget"},
        {"id": 3, "name": "doohickey"},
    ])
    print(f"Processed {len(items)} items")

    stats = calculate_stats([10, 20, 30, 40, 50])
    print(f"Stats: avg={stats['avg']}, sum={stats['sum']}")

    merged = merge_records(
        [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}],
        [{"id": 2, "email": "bob@example.com"}, {"id": 3, "name": "Charlie"}],
    )
    print(f"Merged {len(merged)} records")

    # Test error capture
    try:
        failing_function("bad_input")
    except ValueError as e:
        print(f"Caught expected error: {e}")

    print("Done!")


if __name__ == "__main__":
    main()
