"""App that uses async functions for testing async type generation."""
import asyncio
import trickle.auto  # noqa: F401

from test_async_lib import fetch_user, search_products, format_price, ApiClient


async def main():
    user = await fetch_user("u123")
    print("user:", user["name"])

    products = await search_products("widget", 10)
    print("products:", products["total"])

    price = format_price(19.99, "$")
    print("price:", price["formatted"])

    client = ApiClient()
    profile = await client.get_profile("u456")
    print("profile:", profile["display_name"])

    comment = await client.post_comment("p789", "Great post!")
    print("comment:", comment["comment_id"])

    version = client.get_version()
    print("version:", version["version"])


asyncio.run(main())
print("Done!")
