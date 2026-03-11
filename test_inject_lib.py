"""Library for testing Python type hint injection.
These functions have NO type annotations — trickle will add them.
"""


def calculate_tax(amount, rate):
    tax = amount * (rate / 100)
    return {
        "amount": amount,
        "rate": rate,
        "tax": tax,
        "total": amount + tax,
    }


def format_user(user, locale="en-US"):
    return {
        "display": f"{user['first_name']} {user['last_name']}",
        "email": user["email"].lower(),
        "locale": locale,
    }


def filter_items(items, min_value):
    matching = [x for x in items if x > min_value]
    return {
        "results": matching,
        "count": len(matching),
        "total": len(items),
    }
