Think of 1 item to work on ML engineer user case to improve the developer experience.

For now, i want you to specifically focus on:
<focus point>
JS/TS and Python inline type hints are fully working. pytest, async/await, HuggingFace configs, type drift alerts, call flow, asyncio.gather() per-element typing, cross-run type history, training loop progress status bar, and dict/object inline value display are all implemented. Next priorities:

1. Exception/error observability: when an exception is raised during a traced function, capture the exception type, message, and local variable state at the point of failure — show inline annotations on the failing line so the developer can see what values led to the error without adding print statements.

2. Automatic training metric detection: when `trickle.auto` is active and the tracer sees variables named `loss`, `epoch`, `step` being written in a loop, automatically emit progress records without requiring the user to add `trickle.progress()` explicitly.

3. AWS Lambda support: JS/TS code running in Lambda functions should be observable with minimal setup — possibly via a Lambda layer that injects the ESM hooks or CJS register hook automatically.

4. Gradient flow visualization: for PyTorch training, show per-parameter gradient norms as inlay hints on the model's forward() method lines, so the user can see which layers have vanishing/exploding gradients without adding hooks manually.

</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the ML repos you can find online. for example test on karpathy's gpt-2 implementation.
please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, and keep the rest of mission.md the same.
