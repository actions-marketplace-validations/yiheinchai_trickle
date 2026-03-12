"""App that calls polymorphic functions with different argument types."""
import trickle.auto  # noqa: F401

from test_overload_lib import format_value, convert, Parser

# Call format_value with string
r1 = format_value("hello")
print("format string:", r1["formatted"])

# Call format_value with int
r2 = format_value(42)
print("format int:", r2["formatted"])

# Call convert with string → string
c1 = convert("hello", "string")
print("convert string->string:", c1)

# Call convert with int → string
c2 = convert(42, "string")
print("convert int->string:", c2)

# Parser class with different input types
parser = Parser()
p1 = parser.parse("hello world foo")
print("parse string:", p1["count"])

p2 = parser.parse(["a", "b", "c"])
print("parse array:", p2["count"])

print("Done!")
