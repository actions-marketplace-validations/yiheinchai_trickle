---
name: switch-env
description: "Switch trickle packages between local symlinked development versions and published registry versions. Use when the user asks to switch to local/dev/symlinked, switch to published/production/registry, or test with published packages."
disable-model-invocation: true
argument-hint: "[local|published]"
---

# Switch Trickle Package Environment

Switches all trickle packages between local development (symlinked) and published (registry) versions.

## Switch to local (symlinked)

For development — uses the source code directly so changes are reflected immediately.

```bash
# npm: link CLI and JS client globally
cd packages/cli && npm link
cd packages/client-js && npm link

# Python: editable install
cd packages/client-python && pip install -e .

# VSCode extension: copy built dist to installed extension
cd packages/vscode-extension && npm run build
cp dist/extension.js ~/.vscode/extensions/yiheinchai.trickle-vscode-*/dist/extension.js
```

Then tell the user to reload VSCode.

## Switch to published (registry)

For testing what end users will get from npm/PyPI.

```bash
# npm: unlink and install from registry
npm unlink -g trickle-cli
npm unlink -g trickle-observe
npm install -g trickle-cli
npm install -g trickle-observe

# Python: uninstall editable, install from PyPI
pip uninstall trickle trickle-observe -y
pip install trickle-observe
```

## Verify

After switching, verify with:
```bash
# Check CLI — symlink vs real install
which trickle && ls -la $(which trickle)

# Check Python — look for "Editable project location" (local) vs plain Location (published)
pip show trickle-observe | grep -E "Version|Location|Editable"

# Check npm global
npm ls -g trickle-observe trickle-cli --depth=0
```

## Important notes

- The old Python package name was `trickle` (editable install). If switching from local to published, uninstall both `trickle` AND `trickle-observe` to avoid conflicts.
- Python uses `/opt/anaconda3/bin/python` — system `python3` points to 3.14 which may lack build tools.
- After switching VSCode extension, user must reload VSCode (Cmd+Shift+P -> "Developer: Reload Window").
