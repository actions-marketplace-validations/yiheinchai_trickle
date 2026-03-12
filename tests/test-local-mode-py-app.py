"""App used by test-local-mode-e2e.js for Python local mode test."""


def greet_user(name, greeting="Hello"):
    return {"message": f"{greeting}, {name}!", "length": len(name)}


def sum_list(numbers):
    total = sum(numbers)
    return {"total": total, "count": len(numbers), "average": total / len(numbers) if numbers else 0}


result = greet_user("Alice", greeting="Hi")
print("Greeting:", result["message"])

nums = sum_list([10, 20, 30, 40])
print("Sum:", nums["total"])

print("Done!")
