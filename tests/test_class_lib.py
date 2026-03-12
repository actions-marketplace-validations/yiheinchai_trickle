"""Library with class-based code for testing class method observation."""


class Calculator:
    def add(self, a, b):
        return {"result": a + b, "operation": "add"}

    def multiply(self, a, b):
        return {"result": a * b, "operation": "multiply"}

    def square(self, x):
        return {"result": x * x, "input": x}


class Formatter:
    def format_name(self, first, last):
        return {"display": f"{first} {last}", "first": first, "last": last}

    def format_currency(self, amount, currency):
        return {"formatted": f"{currency}{amount:.2f}", "amount": amount, "currency": currency}
