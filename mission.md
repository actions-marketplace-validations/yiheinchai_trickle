BEFORE DOING ANYTHING, read principles.md. It governs all work on this project.

Think of 1 item to work to improve the developer experience with trickle.

For now, i want you to specifically focus on:
<higher directive>
Trickle gives you runtime context — types, shapes, values, error state — for every variable in your code. It's for the development process: when you're working with unfamiliar data, iterating on code, and need to understand what's actually flowing through each line without adding print statements.

The core insight: AI agents write correct code but fail on data they haven't seen (file formats, tensor shapes, API responses, edge cases in datasets). Trickle bridges this gap — run the code, see what the data actually looks like, then write code that handles it correctly.

Two interfaces: (1) VSCode inline hints for human developers iterating in notebooks/scripts, and (2) `trickle hints` CLI output for AI agents that need runtime context in the terminal.

HOW TO IMPROVE TRICKLE: Do not think of features. Instead, build something real on an unfamiliar codebase using trickle as your tool. Where trickle's output fails to help you — wrong types, missing variables, unhelpful error context, slow performance — that's the gap to fix. Every past improvement that users actually valued came from this pattern. Every feature that went unused came from an agent imagining what might be useful.
</higher directive>

<focus point>
1. **Error debugging experience** — DONE (0.2.58, vscode 0.1.82): Error mode now captures ALL variables at crash time from all user-code frames (including list comprehension scopes), places hints on each variable's original assignment line (not stacked on the error line), and shows crash-time values. Works for both notebooks (`%load_ext trickle`) and scripts (`trickle run`). CLI error mode (`trickle hints --errors`) outputs source with inline crash-time values plus ~~~ underline on the error line — usable by AI agents. The `--show types|values|both` flag controls what's displayed. Real-world validated: caught demographics.txt parsing error with file_path="demographics.txt" visible inline.

2. **Runtime-aware autocomplete and semantic highlighting** — DONE (vscode 0.1.82): When trickle observes a variable's runtime type (e.g., Tensor), the extension provides autocomplete for known methods/properties (shape, dtype, view, reshape, etc.) and semantic token highlighting (properties blue, methods yellow). Scoped to function context — different `t` in different functions won't interfere. Supports Tensor, ndarray, DataFrame, Series, plus any observed object properties.

3. **trickle hints CLI for AI agents** — DONE (CLI 0.1.219): `trickle hints [file]` outputs source code with inline type annotations (like VSCode inlay hints) as plain text in the terminal. `trickle hints --errors` shows crash-time variable state with error underline. This gives AI agents (Claude Code, Cursor, etc.) access to runtime type information without needing the VSCode extension. Designed for agent debugging workflows: `trickle run python app.py && trickle hints --errors`.

4. **Union type rendering** — DONE (vscode 0.1.78): Fixed Python's `{"kind": "union", "members": [...]}` not being recognized (extension expected `elements`). Arrays of tensors with different shapes now show as `Tensor[]` instead of `unknown[]`. Hover tooltip shows the full union with all shapes.

5. **GitHub MCP Registry listing** — The submission process is concrete: install `mcp-publisher` CLI, create server.json, verify namespace ownership, submit. Use package deployment type (npm: trickle-cli). Cursor just launched 30+ MCP plugins — trickle must be discoverable alongside them. Submit to all three: GitHub MCP Registry, mcp.so, and registry.modelcontextprotocol.io. This is free distribution to every AI coding agent user — highest leverage action.
</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. if you are unsure what to work on, test trickle on a real world codebase js/ts/python and see what pain points you experience, and then work on that.

before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the repos you can find online. for example ML you can test on karpathy's gpt-2 implementation. for react ts, find a react repo online. the key is you must try to search for a variety of real world codebases relevant to your chanfe to test it to ensure it has real world value.

please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing, only publish packages affect by your change). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, the focus points should follow the general directive, and keep the rest of mission.md the same.

DO NOT ever believe that trickle is done, it is not. If focus point says all done, delete all text within focus point and come up with ideas that follows the directive.
