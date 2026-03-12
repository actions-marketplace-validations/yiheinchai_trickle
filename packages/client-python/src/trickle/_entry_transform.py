"""AST transformation for entry file deep observation.

When ``trickle run script.py`` is used, the entry file is executed via
``runpy.run_path()`` — which means ``builtins.__import__`` never fires
for functions defined in the entry file itself.  Those functions would
be invisible to trickle.

This module solves the problem by:

1. Parsing the entry file's source with Python's ``ast`` module
2. Finding all function/async function definitions
3. Inserting wrapper calls immediately after each definition
4. Inserting variable trace calls after each assignment statement
5. Compiling and executing the transformed AST

The result is that ALL functions in the entry file are observed and
ALL variable assignments are traced with their runtime types/shapes,
matching the deep observation behavior for imported modules.
"""

from __future__ import annotations

import ast
import json
import os
import sys
from typing import Any, Dict, Optional, Set


def run_entry_with_observation(
    filepath: str,
    module_name: Optional[str] = None,
    trace_vars: bool = True,
) -> None:
    """Execute a Python script with all its functions wrapped for observation.

    This replaces ``runpy.run_path()`` for entry files, adding automatic
    function wrapping via AST transformation and variable tracing.

    Instead of using exec() with custom globals (which breaks complex imports
    like torch), this writes a transformed source file and runs it with
    runpy.run_path(), prepending the tracer/wrapper setup code as imports.
    """
    import tempfile

    abs_path = os.path.abspath(filepath)

    if module_name is None:
        module_name = os.path.basename(filepath).rsplit(".", 1)[0]

    # Check env for trace_vars override
    if os.environ.get("TRICKLE_TRACE_VARS", "1") in ("0", "false"):
        trace_vars = False

    # Read source
    with open(abs_path, "r", encoding="utf-8") as f:
        source = f.read()

    # Transform source text (not AST-compiled code, but source string)
    try:
        transformed_source = _transform_to_source(source, abs_path, module_name, trace_vars=trace_vars)
    except SyntaxError:
        # If AST parsing fails, fall back to plain runpy
        import runpy
        runpy.run_path(filepath, run_name="__main__")
        return

    # Write transformed source to a temp file next to the original
    # so relative imports still work
    script_dir = os.path.dirname(abs_path)
    fd, tmp_path = tempfile.mkstemp(suffix=".py", dir=script_dir, prefix=".trickle_")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(transformed_source)

        # Add the script's directory to sys.path
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)

        sys.argv[0] = abs_path

        import runpy
        runpy.run_path(tmp_path, run_name="__main__")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _make_var_tracer(filepath: str, module_name: str) -> Any:
    """Create the __trickle_tv function that traces variable assignments.

    Returns a function(value, var_name, line_no) that:
    1. Infers the runtime type (including tensor shapes)
    2. Caches by (file, line, var_name, type_hash) to avoid redundant writes
    3. Appends to .trickle/variables.jsonl
    """
    from .type_inference import infer_type

    cache: Set[str] = set()
    vars_file: Optional[str] = None

    def _tv(value: Any, var_name: str, line_no: int) -> None:
        nonlocal vars_file
        try:
            if vars_file is None:
                local_dir = os.environ.get("TRICKLE_LOCAL_DIR") or os.path.join(os.getcwd(), ".trickle")
                os.makedirs(local_dir, exist_ok=True)
                vars_file = os.path.join(local_dir, "variables.jsonl")

            type_node = infer_type(value, max_depth=3)
            type_hash = json.dumps(type_node, sort_keys=True)[:32]
            cache_key = f"{filepath}:{line_no}:{var_name}:{type_hash}"

            if cache_key in cache:
                return
            cache.add(cache_key)

            # Build a small sample value for display
            sample = _sanitize(value, depth=2)

            record = {
                "kind": "variable",
                "varName": var_name,
                "line": line_no,
                "module": module_name,
                "file": filepath,
                "type": type_node,
                "typeHash": type_hash,
                "sample": sample,
            }
            with open(vars_file, "a") as f:
                f.write(json.dumps(record) + "\n")
        except Exception:
            pass  # Never break user code

    return _tv


def _sanitize(value: Any, depth: int = 2) -> Any:
    """Create a small JSON-safe sample of a value for display."""
    if depth <= 0:
        return "[truncated]"
    if value is None:
        return None
    t = type(value)
    tname = t.__name__

    # Tensor-like objects: show shape info as the sample
    if hasattr(value, "shape") and hasattr(value, "dtype"):
        parts = [f"shape={list(value.shape)}", f"dtype={value.dtype}"]
        if hasattr(value, "device"):
            parts.append(f"device={value.device}")
        return f"{tname}({', '.join(parts)})"

    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value[:100] + "..." if len(value) > 100 else value
    if isinstance(value, (list, tuple)):
        items = [_sanitize(v, depth - 1) for v in value[:3]]
        if len(value) > 3:
            items.append(f"...({len(value)} total)")
        return items
    if isinstance(value, dict):
        r = {}
        for i, (k, v) in enumerate(value.items()):
            if i >= 5:
                r["..."] = f"({len(value)} total)"
                break
            r[str(k)] = _sanitize(v, depth - 1)
        return r
    return str(value)[:100]


def _transform_to_source(source: str, filename: str, module_name: str, trace_vars: bool = True) -> str:
    """Parse and transform source, returning the transformed Python source string.

    This generates a self-contained Python source with the tracer/wrapper
    setup code prepended, so it can be written to a file and run with runpy.
    """
    tree = ast.parse(source, filename)

    # Transform the top-level body
    tree.body = _transform_body(tree.body, trace_vars=trace_vars)

    # Also transform class bodies (methods)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            node.body = _transform_body(node.body, trace_vars=trace_vars)

    # Transform function bodies for variable tracing
    if trace_vars:
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                node.body = _transform_func_body(node.body)

    ast.fix_missing_locations(tree)

    # Convert AST back to source
    transformed = ast.unparse(tree)

    # Prepend the tracer setup code
    setup = _generate_setup_code(filename, module_name, trace_vars)
    return setup + "\n" + transformed


def _generate_setup_code(filename: str, module_name: str, trace_vars: bool) -> str:
    """Generate the Python source code that sets up __trickle_wrap and __trickle_tv."""
    lines = [
        "# --- trickle auto-instrumentation preamble ---",
        "import os as __trickle_os",
        "import json as __trickle_json",
    ]

    # Function wrapper — when variable tracing is active, function wrapping
    # is redundant (the tracer captures all values) and can interfere with
    # frameworks like PyTorch whose tensors don't work through proxies.
    if trace_vars:
        lines.append("def __trickle_wrap(__fn, __name): return __fn")
    else:
        lines.extend([
            "def __trickle_wrap(__fn, __name):",
            "    try:",
            "        from trickle.decorator import _wrap",
            f"        return _wrap(__fn, name=__name, module={module_name!r})",
            "    except Exception:",
            "        return __fn",
        ])

    if trace_vars:
        lines.extend([
            "# Variable tracer with tensor shape support",
            "__trickle_tv_cache = set()",
            "__trickle_tv_file = None",
            "def __trickle_tv(__val, __name, __line):",
            "    global __trickle_tv_file",
            "    try:",
            "        if __trickle_tv_file is None:",
            "            __d = __trickle_os.environ.get('TRICKLE_LOCAL_DIR') or __trickle_os.path.join(__trickle_os.getcwd(), '.trickle')",
            "            __trickle_os.makedirs(__d, exist_ok=True)",
            "            __trickle_tv_file = __trickle_os.path.join(__d, 'variables.jsonl')",
            "        from trickle.type_inference import infer_type",
            "        __t = infer_type(__val, max_depth=3)",
            "        __th = __trickle_json.dumps(__t, sort_keys=True)[:32]",
            f"        __ck = {filename!r} + ':' + str(__line) + ':' + __name + ':' + __th",
            "        if __ck in __trickle_tv_cache:",
            "            return",
            "        __trickle_tv_cache.add(__ck)",
            "        # Build sample",
            "        __s = None",
            "        if hasattr(__val, 'shape') and hasattr(__val, 'dtype'):",
            "            __parts = [f'shape={list(__val.shape)}', f'dtype={__val.dtype}']",
            "            if hasattr(__val, 'device'): __parts.append(f'device={__val.device}')",
            "            __s = f'{type(__val).__name__}({\", \".join(__parts)})'",
            "        elif isinstance(__val, (int, float, bool)):",
            "            __s = __val",
            "        elif isinstance(__val, str):",
            "            __s = __val[:100]",
            "        else:",
            "            __s = str(__val)[:100]",
            f"        __r = {{'kind': 'variable', 'varName': __name, 'line': __line, 'module': {module_name!r}, 'file': {filename!r}, 'type': __t, 'typeHash': __th, 'sample': __s}}",
            "        with open(__trickle_tv_file, 'a') as __f:",
            "            __f.write(__trickle_json.dumps(__r) + '\\n')",
            "    except Exception:",
            "        pass",
        ])
    else:
        lines.append("def __trickle_tv(__val, __name, __line): pass")

    lines.append("# --- end trickle preamble ---")
    return "\n".join(lines)


def _transform_source(source: str, filename: str, trace_vars: bool = True) -> Any:
    """Parse and transform source to wrap all function definitions and trace variables.

    For each function/async function definition at any level, inserts
    a re-assignment statement immediately after::

        def process_data(items):
            ...
        process_data = __trickle_wrap(process_data, 'process_data')  # inserted

    For each variable assignment, inserts a trace call::

        x = some_computation()
        __trickle_tv(x, 'x', 42)  # inserted — line 42

    Only wraps top-level and class-level functions (not nested functions,
    which are handled by their parent's observation).
    """
    tree = ast.parse(source, filename)

    # Transform the top-level body
    tree.body = _transform_body(tree.body, trace_vars=trace_vars)

    # Also transform class bodies (methods)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            node.body = _transform_body(node.body, trace_vars=trace_vars)

    # Transform function bodies for variable tracing
    if trace_vars:
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                node.body = _transform_func_body(node.body)

    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


def _transform_body(body: list, trace_vars: bool = True) -> list:
    """Insert wrapper calls after function defs and trace calls after assignments."""
    new_body: list = []

    for node in body:
        new_body.append(node)

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Skip private/dunder methods
            if node.name.startswith("_"):
                continue

            # Insert: func_name = __trickle_wrap(func_name, 'func_name')
            wrap_stmt = ast.Assign(
                targets=[ast.Name(id=node.name, ctx=ast.Store())],
                value=ast.Call(
                    func=ast.Name(id="__trickle_wrap", ctx=ast.Load()),
                    args=[
                        ast.Name(id=node.name, ctx=ast.Load()),
                        ast.Constant(value=node.name),
                    ],
                    keywords=[],
                ),
            )
            new_body.append(wrap_stmt)
            continue

        # Trace variable assignments at module/class level
        if trace_vars:
            trace_stmts = _make_trace_stmts(node)
            new_body.extend(trace_stmts)

    return new_body


def _transform_func_body(body: list) -> list:
    """Insert trace calls after variable assignments inside function bodies."""
    new_body: list = []

    for node in body:
        new_body.append(node)

        # Recurse into compound statements
        if isinstance(node, (ast.If, ast.While, ast.For, ast.AsyncFor)):
            node.body = _transform_func_body(node.body)
            if hasattr(node, "orelse") and node.orelse:
                node.orelse = _transform_func_body(node.orelse)
            continue

        if isinstance(node, (ast.With, ast.AsyncWith)):
            node.body = _transform_func_body(node.body)
            continue

        if isinstance(node, ast.Try):
            node.body = _transform_func_body(node.body)
            for handler in node.handlers:
                handler.body = _transform_func_body(handler.body)
            if node.orelse:
                node.orelse = _transform_func_body(node.orelse)
            if node.finalbody:
                node.finalbody = _transform_func_body(node.finalbody)
            continue

        # Don't recurse into nested function defs (they get their own treatment)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        trace_stmts = _make_trace_stmts(node)
        new_body.extend(trace_stmts)

    return new_body


def _make_trace_stmts(node: ast.AST) -> list:
    """Generate __trickle_tv() calls for variable names assigned in this node."""
    names = _extract_assigned_names(node)
    stmts = []
    for name in names:
        # __trickle_tv(var_name_value, 'var_name', line_no)
        trace_call = ast.Expr(
            value=ast.Call(
                func=ast.Name(id="__trickle_tv", ctx=ast.Load()),
                args=[
                    ast.Name(id=name, ctx=ast.Load()),
                    ast.Constant(value=name),
                    ast.Constant(value=getattr(node, "lineno", 0)),
                ],
                keywords=[],
            )
        )
        stmts.append(trace_call)
    return stmts


def _extract_assigned_names(node: ast.AST) -> list:
    """Extract simple variable names from an assignment node.

    Handles:
      - ast.Assign: x = ..., x, y = ..., (a, b) = ...
      - ast.AnnAssign: x: int = ...
      - ast.AugAssign: x += ...
      - Destructuring: a, b = ..., [a, b] = ..., etc.
    """
    names: list = []

    if isinstance(node, ast.Assign):
        for target in node.targets:
            names.extend(_names_from_target(target))
    elif isinstance(node, ast.AnnAssign):
        if node.value is not None and node.target:
            names.extend(_names_from_target(node.target))
    elif isinstance(node, ast.AugAssign):
        names.extend(_names_from_target(node.target))

    # Filter out private/dunder names and trickle internals
    return [n for n in names if not n.startswith("_")]


def _names_from_target(target: ast.AST) -> list:
    """Recursively extract variable names from an assignment target."""
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for elt in target.elts:
            names.extend(_names_from_target(elt))
        return names
    if isinstance(target, ast.Starred):
        return _names_from_target(target.value)
    return []
