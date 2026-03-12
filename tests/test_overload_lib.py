"""Library with polymorphic functions for testing overload generation."""


def format_value(value):
    if isinstance(value, str):
        return {"formatted": value.upper(), "kind": "string"}
    if isinstance(value, (int, float)):
        return {"formatted": f"{value:.2f}", "kind": "number"}
    if isinstance(value, bool):
        return {"formatted": "yes" if value else "no", "kind": "boolean"}
    return {"formatted": str(value), "kind": "unknown"}


def convert(input_val, target):
    if target == "string":
        return str(input_val)
    if target == "number":
        return float(input_val)
    return input_val


class Parser:
    def parse(self, input_val):
        if isinstance(input_val, str):
            tokens = input_val.split(" ")
            return {"tokens": tokens, "count": len(tokens)}
        if isinstance(input_val, list):
            return {"tokens": input_val, "count": len(input_val)}
        return {"tokens": [], "count": 0}
