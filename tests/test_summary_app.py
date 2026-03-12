"""App for testing type summary output."""
import trickle.auto  # noqa: F401

from test_summary_lib import greet, add, to_upper

greet("World", "Hello")
add(10, 20)
to_upper("hello")

print("Done!")
