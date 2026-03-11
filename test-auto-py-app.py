"""App that uses `import trickle.auto` — one line, no config.
Used by test-auto-py-e2e.py.
"""

# This ONE LINE is all you need:
import trickle.auto  # noqa: F401

# --- Your normal app code below ---
from test_auto_py_lib import calculate_discount, format_invoice, validate_address

# Exercise the functions
disc = calculate_discount(99.99, 15)
print(f"Discount: {disc['saved']}")

invoice = format_invoice(
    [
        {"name": "Widget", "price": 25, "qty": 4},
        {"name": "Gadget", "price": 50, "qty": 1},
    ],
    {"name": "Alice Smith"},
)
print(f"Invoice total: {invoice['total']}")

addr = validate_address({
    "street": "123 Main St",
    "city": "Springfield",
    "state": "il",
    "zip": "62701",
})
print(f"Address valid: {addr['valid']}")

print("Done!")
