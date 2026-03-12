---
name: publish
description: "Publish all trickle packages (npm, PyPI, VSCode extension). Use when the user asks to publish, release, bump versions, or push packages to registries."
disable-model-invocation: true
argument-hint: "[version-bump: patch|minor|major]"
---

# Publish Trickle Packages

Publishes all packages in the trickle monorepo. Default bump is `patch`.

## Packages

| Package | Registry | Name | Location |
|---------|----------|------|----------|
| JS Client | npm | `trickle-observe` | `packages/client-js` |
| CLI | npm | `trickle-cli` | `packages/cli` |
| Backend | npm | `trickle-backend` | `packages/backend` |
| Python Client | PyPI | `trickle-observe` | `packages/client-python` |
| VSCode Extension | VS Marketplace | `yiheinchai.trickle-vscode` | `packages/vscode-extension` |

## Steps

### 1. Bump versions

Determine the bump type from the argument (default: `patch`).

**npm packages** (JS client, CLI, backend):
```bash
cd packages/client-js && npm version <bump> --no-git-tag-version
cd packages/cli && npm version <bump> --no-git-tag-version
cd packages/backend && npm version <bump> --no-git-tag-version
cd packages/vscode-extension && npm version <bump> --no-git-tag-version
```

**Python** — edit `packages/client-python/pyproject.toml` and update the `version` field.

### 2. Build all packages

Run all builds in parallel:
```bash
cd packages/client-js && npm run build
cd packages/cli && npm run build
cd packages/backend && npm run build
cd packages/vscode-extension && npm run build
cd packages/client-python && rm -rf dist/ && /opt/anaconda3/bin/python -m build
```

### 3. Publish npm packages

npm requires passkey auth, so give the user the commands to run manually:
```bash
cd packages/client-js && npm publish
cd packages/cli && npm publish
cd packages/backend && npm publish
```

### 4. Publish Python package

```bash
cd packages/client-python && twine upload dist/*
```

### 5. Publish VSCode extension

The extension is in a monorepo, so `vsce package` picks up parent files. Work around this by packaging from an isolated temp directory:

```bash
mkdir -p /tmp/trickle-vsce/dist
cp packages/vscode-extension/package.json /tmp/trickle-vsce/
cp packages/vscode-extension/dist/extension.js /tmp/trickle-vsce/dist/
cd /tmp/trickle-vsce && vsce package --allow-missing-repository
cd /tmp/trickle-vsce && vsce publish --allow-missing-repository
```

### 6. Update installed VSCode extension locally

After publishing, also update the local installed copy so the user sees changes immediately:
```bash
cp packages/vscode-extension/dist/extension.js ~/.vscode/extensions/yiheinchai.trickle-vscode-*/dist/extension.js
```
Then tell user to reload VSCode (Cmd+Shift+P -> "Developer: Reload Window").

### 7. Commit and push

```bash
git add packages/backend/package.json packages/cli/package.json packages/client-js/package.json packages/client-python/pyproject.toml packages/vscode-extension/package.json package-lock.json
git commit -m "Bump versions for publish: <list versions>"
git push
```

## Important notes

- npm publish requires passkey auth — give user the commands to run themselves
- PyPI package name is `trickle-observe` (not `trickle`, which is taken by someone else)
- VSCode publisher is `yiheinchai`
- Python must be built with `/opt/anaconda3/bin/python` (system python3 points to 3.14 which lacks the `build` module)
- Always build before publishing to ensure dist is up to date
