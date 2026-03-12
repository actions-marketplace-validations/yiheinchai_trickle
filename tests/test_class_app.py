"""App that uses class-based code for testing class method observation."""
import trickle.auto  # noqa: F401

from test_class_lib import Calculator, Formatter

calc = Calculator()
print("add:", calc.add(10, 5)["result"])
print("multiply:", calc.multiply(3, 4)["result"])
print("square:", calc.square(7)["result"])

fmt = Formatter()
print("name:", fmt.format_name("John", "Doe")["display"])
print("currency:", fmt.format_currency(99.99, "$")["formatted"])

print("Done!")
