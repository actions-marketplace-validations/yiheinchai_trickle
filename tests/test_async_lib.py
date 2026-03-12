"""Library with async functions for testing async type generation."""
import asyncio


async def fetch_user(user_id):
    return {"id": user_id, "name": "Alice", "email": "alice@example.com", "active": True}


async def search_products(query, limit):
    return {"results": [{"id": 1, "name": "Widget", "price": 9.99}], "total": 1, "query": query}


def format_price(amount, currency):
    return {"formatted": f"{currency}{amount:.2f}", "amount": amount, "currency": currency}


class ApiClient:
    async def get_profile(self, user_id):
        return {"user_id": user_id, "display_name": "Bob", "role": "admin"}

    async def post_comment(self, post_id, text):
        return {"comment_id": 42, "post_id": post_id, "text": text, "created_at": "2026-01-01"}

    def get_version(self):
        return {"version": "1.0.0", "build": 123}
