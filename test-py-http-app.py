"""
App that makes HTTP requests using the `requests` library.
Trickle should auto-capture types from the JSON responses.
"""
import requests

API = "http://localhost:4569"


def main():
    # GET request — fetch list of users
    resp = requests.get(f"{API}/api/users")
    users = resp.json()
    print(f"users: {len(users)} items")

    # GET request — fetch config object
    resp = requests.get(f"{API}/api/config")
    config = resp.json()
    print(f"config: {config['appName']} {config['version']}")

    # POST request — create a new user
    resp = requests.post(
        f"{API}/api/users",
        json={"name": "Dave Brown", "email": "dave@example.com", "role": "user"},
    )
    created = resp.json()
    print(f"created: {created['name']} id: {created['id']}")

    print("Done!")


if __name__ == "__main__":
    main()
