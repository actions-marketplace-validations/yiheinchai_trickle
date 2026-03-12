"""Test app for Python type hint injection."""
import trickle.auto

from test_inject_lib import calculate_tax, format_user, filter_items

tax = calculate_tax(100, 8.5)
print(f"Tax: {tax['tax']}")

user = format_user(
    {"first_name": "Alice", "last_name": "Smith", "email": "ALICE@EXAMPLE.COM"},
    "en-GB",
)
print(f"User: {user['display']}")

filtered = filter_items([1, 2, 3, 4, 5], 3)
print(f"Filtered: {filtered['count']}")

print("Done!")
