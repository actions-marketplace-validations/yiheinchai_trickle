Think of 1 item to work on ML engineer user case to improve the developer experience.

For now, i want you to specifically focus on:
<focus point>
JS/TS and Python inline type hints are fully working. Vitest+React integration is verified. Nested type hover tooltips now render as structured, indented TypeScript-style type blocks (using `typeNodeToPretty`) instead of flat strings — complex objects and arrays of objects get pretty-printed in a code block on hover. Next priorities:

1. pytest integration: when running `pytest`, Python test files should get variable tracing so developers see types while writing tests. Similar to Vitest for JS — instrument test function locals automatically. This is the highest-value next item for ML engineers writing model tests.

2. Multi-file project tracing: when a training script imports from local modules (e.g., `from model import GPT`), variables inside those imported modules are traced individually but not linked to the call site in the entry script. Improve by correlating variable traces across files — e.g., when `model = GPT(config)` is executed, the inline hint at the call site should show `GPT(n_layer=12, n_head=12, ...)` populated from the `__init__` trace in model.py.

3. Python async support: `async def` functions and `asyncio.gather()` return values are not yet traced. Improve to trace coroutine results after `await`.

4. AWS Lambda support: JS/TS code running in Lambda functions should be observable with minimal setup — possibly via a Lambda layer that injects the ESM hooks or CJS register hook automatically.

</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the ML repos you can find online. for example test on karpathy's gpt-2 implementation.
please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, and keep the rest of mission.md the same.
