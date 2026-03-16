"""Universal function observation — wrap any module or dict of functions.

Usage::

    from trickle import observe, observe_fn

    # Wrap all functions in a module (including class methods)
    import my_helpers
    helpers = observe(my_helpers, module="my-helpers")
    helpers.fetch_user("user_123")  # types + sample data captured

    # Wrap a dict of functions
    traced = observe({
        "fetch_user": fetch_user,
        "create_order": create_order,
    }, module="api")

    # Wrap a single function
    traced_fetch = observe_fn(fetch_user, module="api", name="fetch_user")
"""

from __future__ import annotations

import inspect
import types as pytypes
from typing import Any, Optional

from .decorator import _wrap


def observe(
    obj: Any,
    *,
    module: Optional[str] = None,
) -> Any:
    """Wrap every callable attribute/value on *obj* for type observation.

    *obj* can be a module, a dict of ``{name: fn}``, a class instance,
    or any object whose attributes include functions.

    When encountering classes in a module, their public methods are
    monkey-patched in place so that instances created afterward are
    automatically instrumented.

    Returns a new namespace object (for modules/objects) or dict (for dicts)
    with the same interface — the original is never mutated.
    """
    if obj is None:
        return obj

    module_name = module or _infer_module_name(obj)

    # Dict of functions
    if isinstance(obj, dict):
        result: dict[str, Any] = {}
        for key, val in obj.items():
            if callable(val) and not isinstance(val, type):
                result[key] = _wrap(val, name=key, module=module_name)
            else:
                result[key] = val
        return result

    # Module or object with attributes
    ns = _Namespace()
    items = _get_items(obj)

    for name, val in items:
        if name.startswith("_"):
            # Pass through private/dunder attributes unwrapped
            setattr(ns, name, val)
        elif isinstance(val, type):
            # Class found — instrument its methods in place
            _observe_class(val, module_name)
            setattr(ns, name, val)
        elif callable(val):
            setattr(ns, name, _wrap(val, name=name, module=module_name))
        else:
            setattr(ns, name, val)

    return ns


def observe_fn(
    fn: Any,
    *,
    module: Optional[str] = None,
    name: Optional[str] = None,
) -> Any:
    """Wrap a single function for type observation.

    ::

        traced_fetch = observe_fn(fetch_user, module="api")
    """
    if not callable(fn):
        return fn

    func_name = name or getattr(fn, "__name__", "anonymous")
    func_module = module or getattr(fn, "__module__", "observed")

    return _wrap(fn, name=func_name, module=func_module)


def _observe_class(cls: type, module_name: str) -> None:
    """Monkey-patch a class's public methods in place for observation.

    Wraps regular methods, class methods, and static methods.
    Skips dunder methods and already-wrapped methods.
    """
    class_name = cls.__name__

    for attr_name in list(vars(cls)):
        # Skip dunder methods (except __init__ and __call__)
        if attr_name.startswith("__") and attr_name not in ("__init__", "__call__"):
            continue
        # Skip private methods
        if attr_name.startswith("_") and not attr_name.startswith("__"):
            continue

        try:
            raw = vars(cls)[attr_name]
        except (KeyError, TypeError):
            continue

        obs_name = f"{class_name}.{attr_name}"

        if isinstance(raw, staticmethod):
            fn = raw.__func__
            if callable(fn) and not getattr(fn, "__trickle_wrapped__", False):
                wrapped = _wrap(fn, name=obs_name, module=module_name)
                wrapped.__trickle_wrapped__ = True  # type: ignore[attr-defined]
                setattr(cls, attr_name, staticmethod(wrapped))

        elif isinstance(raw, classmethod):
            fn = raw.__func__
            if callable(fn) and not getattr(fn, "__trickle_wrapped__", False):
                wrapped = _wrap(fn, name=obs_name, module=module_name)
                wrapped.__trickle_wrapped__ = True  # type: ignore[attr-defined]
                setattr(cls, attr_name, classmethod(wrapped))

        elif callable(raw) and isinstance(raw, pytypes.FunctionType):
            if not getattr(raw, "__trickle_wrapped__", False):
                wrapped = _wrap(raw, name=obs_name, module=module_name)
                wrapped.__trickle_wrapped__ = True  # type: ignore[attr-defined]
                setattr(cls, attr_name, wrapped)


class _Namespace:
    """Lightweight attribute container returned by observe()."""

    def __repr__(self) -> str:
        attrs = [a for a in dir(self) if not a.startswith("_")]
        return f"<observed: {', '.join(attrs)}>"


def _get_items(obj: Any) -> list[tuple[str, Any]]:
    """Extract name-value pairs from a module or object."""
    if isinstance(obj, pytypes.ModuleType):
        # For modules, use dir() to get all public names
        items = []
        for name in dir(obj):
            if name.startswith("__"):
                continue
            try:
                val = getattr(obj, name)
                items.append((name, val))
            except AttributeError:
                pass
        return items

    # For objects, iterate over attributes
    items = []
    for name in dir(obj):
        if name.startswith("__"):
            continue
        try:
            val = getattr(obj, name)
            items.append((name, val))
        except AttributeError:
            pass
    return items


def _infer_module_name(obj: Any) -> str:
    """Try to infer a reasonable module name from the object."""
    if isinstance(obj, pytypes.ModuleType):
        name = getattr(obj, "__name__", None)
        if name:
            # Use the last part: "my_app.helpers" → "helpers"
            return name.rsplit(".", 1)[-1]

    if isinstance(obj, dict):
        return "observed"

    cls_name = type(obj).__name__
    if cls_name != "type":
        return cls_name

    return "observed"
