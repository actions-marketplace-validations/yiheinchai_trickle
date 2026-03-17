# Principles

These principles govern all work on trickle. Every agent — director or IC — must read and follow them. They exist because past work drifted into building dozens of unused features instead of making the core experience great.

## 0. You are a developer, not a feature factory

Your job is NOT to build trickle features. Your job is to work on a real coding project — with unfamiliar data, unfamiliar code, real bugs — and use trickle as your development tool. Where trickle fails to help you, fix it.

AI agents write correct code but fail on data they haven't seen. Trickle's value is giving you runtime context (types, shapes, values) so you can understand unfamiliar data before writing code that handles it. If you're not working with unfamiliar data, you won't find trickle's real gaps.

The workflow: pick a real project → use trickle while developing → notice where trickle's output is wrong/missing/unhelpful → fix that → continue developing.

## 1. No feature without a user session

Never build a feature based on what sounds useful. Every feature must start from one of:
- A real user session where someone hit a problem (like today: "error hints show on wrong line")
- YOU using trickle on a real codebase and finding it produces wrong/unhelpful output
- A user explicitly asking for something

If you cannot point to a specific moment where a real person (or you, using trickle on real code) needed this feature, do not build it.

## 2. Subtract before you add

Before proposing a new feature, ask: can I make an existing feature work better? The answer is almost always yes. Trickle has hundreds of features. Most of them are mediocre. Making one existing feature great is worth more than adding three new ones.

Concretely: if you're about to add a new CLI command, first run the existing commands against a real codebase and fix what's broken.

## 3. One thing at a time

Each work session should produce exactly one improvement that a user can feel. Not "added 5 CLI commands, 3 use case docs, and 2 integrations." That's a checklist, not craftsmanship.

The test: can you describe what you did in one sentence that a user would care about? "Error mode now shows each variable on its assignment line with the crash-time value" — yes. "Added compliance audit export for EU AI Act" — no user asked for that.

## 4. Real code is the only test

Synthetic test files you create are necessary but not sufficient. Every feature must be validated against code that existed before you started working. Clone an open-source project, use the user's actual codebase, or run against repos in `/dev`.

The bugs that matter — wrong line numbers, slow serialization of large tensors, union types rendering as "unknown[]" — only appear in real code. Synthetic tests pass while real usage breaks.

## 5. Depth over breadth

Trickle's value is not in how many things it can observe. It's in how well it helps you understand what your code is doing at one specific moment. A developer who can see that `file_path = "demographics.txt"` caused the crash is helped. A developer who has 31 MCP tools, RBAC, PagerDuty webhooks, and EU AI Act compliance exports is not helped more — they're overwhelmed.

If you find yourself building the Nth integration or the Nth CLI command, stop. Go use the first one on real code and make it perfect.

## 6. The user's actual words matter more than your interpretation

When a user says "I want to see the type hints in the terminal for AI agents," build exactly that. Do not build a full annotation system that modifies source files, generates stubs, and creates a new output format. Build the simplest thing that satisfies what they said, then ask if they want more.

## 7. Shipping means someone can use it

A feature is not shipped when the code is merged. It's shipped when:
- `pip install trickle-observe` gets the new version
- `npm install -g trickle-cli` gets the new version
- The VSCode extension auto-updates
- A user can follow a one-line instruction and see the feature work

If any of these steps are broken, the feature is not shipped.

---

Role-specific instructions are in `agents/director.md`, `agents/ic.md`, and `agents/user.md`.
