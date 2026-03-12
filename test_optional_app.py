"""App that calls functions with different numbers of arguments."""
import trickle.auto  # noqa: F401

from test_optional_lib import greet, search, Config

# greet with 1 arg
print("greet 1:", greet("Alice"))

# greet with 2 args
print("greet 2:", greet("Bob", "Hi"))

# search with 1 arg
print("search 1:", search("test")["total"])

# search with 3 args
print("search 3:", search("test", 5, 1)["total"])

# Config.get with 1 arg
config = Config()
print("config 1:", config.get("theme"))

# Config.get with 2 args
print("config 2:", config.get("missing", "fallback"))

print("Done!")
