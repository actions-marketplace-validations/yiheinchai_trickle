"""Library functions used by test-auto-py-app.py.

These are in a separate file so trickle.auto can instrument them
(the import hook wraps functions in modules imported AFTER the hook is installed).
"""


def calculate_discount(price, percentage):
    discount = price * (percentage / 100)
    return {
        "original": price,
        "discount": discount,
        "final": price - discount,
        "saved": f"${discount:.2f}",
    }


def format_invoice(items, customer):
    total = sum(item["price"] * item["qty"] for item in items)
    return {
        "customer": customer["name"],
        "line_items": len(items),
        "subtotal": total,
        "tax": total * 0.08,
        "total": total * 1.08,
        "currency": "USD",
    }


def validate_address(addr):
    return {
        "valid": bool(addr.get("street") and addr.get("city") and addr.get("zip")),
        "normalized": {
            "street": (addr.get("street") or "").strip(),
            "city": (addr.get("city") or "").strip(),
            "state": (addr.get("state") or "").upper(),
            "zip": str(addr.get("zip") or "").replace(" ", ""),
        },
    }
