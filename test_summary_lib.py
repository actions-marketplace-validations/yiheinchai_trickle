"""Library for testing type summary output."""


def greet(name, greeting):
    return {"message": f"{greeting}, {name}!", "name": name, "greeting": greeting}


def add(a, b):
    return {"result": a + b, "a": a, "b": b}


def to_upper(text):
    return {"original": text, "upper": text.upper()}
