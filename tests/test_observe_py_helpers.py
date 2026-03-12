"""Helper functions for Python observe E2E test.
Has ZERO trickle imports — relies on auto-observation."""


def parse_config(raw):
    return {
        "host": raw.get("host", "localhost"),
        "port": raw.get("port", 3000),
        "debug": raw.get("debug", False),
        "retries": raw.get("retries", 3),
    }


def process_items(items):
    return [
        {
            "id": item["id"],
            "name": item["name"].upper(),
            "processed": True,
        }
        for item in items
    ]


def calculate_stats(numbers):
    total = sum(numbers)
    return {
        "sum": total,
        "avg": total / len(numbers),
        "min": min(numbers),
        "max": max(numbers),
        "count": len(numbers),
    }


def merge_records(records_a, records_b):
    """Merge two lists of records by ID."""
    by_id = {}
    for r in records_a:
        by_id[r["id"]] = dict(r)
    for r in records_b:
        if r["id"] in by_id:
            by_id[r["id"]].update(r)
        else:
            by_id[r["id"]] = dict(r)
    return list(by_id.values())


def failing_function(value):
    """This function always raises."""
    raise ValueError(f"Invalid value: {value}")
