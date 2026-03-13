Think of 1 item to work on ML engineer user case to improve the developer experience.

For now, i want you to specifically focus on:
<general directive>
First do some comms, work clarify the difference between trickle generating pyi files vs the jsonl and generate inline hints via extension, and resolve the inconsistencies between these two across different usecases. the same for javascript/typescript (.d.ts vs jsonl + extension). probably the best approach is give user option for both?

First pick a usecase, get a real world repo from online for that use case. Test trickle on that repo. 
Find the pain points. Implement features to fix the pain point.
</general directive>

<focus point>

Completed: Users can now control stub generation via `TRICKLE_STUBS=0` env var (disables .pyi/.d.ts while keeping JSONL + inline hints). Implemented in Python (`auto.py`, `observe_runner.py`) and CLI local mode (`run.ts`). Terminal summary improved to label outputs clearly.

Next priorities:

1. **Context manager return types** — `@contextlib.contextmanager` hides the generator nature of the function. The variable tracer captures the yielded value's type, but the function observation shows `Callable` instead of `ContextManager[T]`. Need to detect and handle `@contextmanager`-decorated functions.

2. **ESM entry file observation** — JS/TS ESM entry files (using `import`/`export`) don't get their top-level functions observed. The CJS `require`-hook works, but ESM loader hooks can't patch the entry module. Investigate `--import` flag or AST-transform approach.

3. **Async generator support testing** — Async generators (`async def ... yield`) are now supported but need testing on real-world async codebases (e.g., aiohttp handlers, async data streams).

4. **Real-world ML testing** — Test trickle on real ML codebases (e.g., karpathy/nanoGPT, huggingface transformers) to find pain points with tensor shapes, dataloader types, model forward pass signatures.

</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. if you are unsure what to work on, test trickle on a real world codebase js/ts/python and see what pain points you experience, and then work on that.

before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the repos you can find online. for example ML you can test on karpathy's gpt-2 implementation. for react ts, find a react repo online. the key is you must try to search for a variety of real world codebases relevant to your chanfe to test it to ensure it has real world value.


please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing, only publish packages affect by your change). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, the focus points should follow the general directive, and keep the rest of mission.md the same.
