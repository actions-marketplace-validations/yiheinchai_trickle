"""Library with functions that accept optional parameters."""


def greet(name, greeting=None):
    if greeting:
        return f"{greeting}, {name}!"
    return f"Hello, {name}!"


def search(query, limit=None, offset=None):
    results = ["result1", "result2", "result3"]
    start = offset or 0
    end = (limit or 10) + start
    return {"results": results[start:end], "query": query, "total": len(results)}


class Config:
    def get(self, key, default_value=None):
        store = {"theme": "dark", "lang": "en"}
        return store.get(key) or default_value
