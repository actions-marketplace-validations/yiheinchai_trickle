Think of 1 item to work on ML engineer user case to improve the developer experience.

For now, i want you to specifically focus on:
<focus point>
JS/TS inline type hints are working end-to-end for plain JS, TypeScript, and ESM .mjs files. Real-world multi-file ESM testing confirmed: 21 variables traced across 2 files with correct line numbers, types, and readable sample values. CLI summary now shows "Variables traced: N" instead of confusing "No functions captured". Next priorities:

1. React component support: inline type hints for state, props, and hooks (useState, useEffect return values). JSX/TSX files aren't yet transformed by the ESM hooks. Approach: detect JSX syntax and strip it before regex-based variable finding, or integrate with a TSX/Babel transform.

2. Vitest/Jest integration: test files should get variable tracing so developers see types while writing tests. The NODE_OPTIONS path already adds ESM hooks — verify it works with a real Vitest project.

3. AWS Lambda support: JS/TS code running in Lambda functions should be observable with minimal setup — possibly via a Lambda layer.

4. Python: better display for dataclasses and NamedTuples — show field names compactly (like JS objects now do) instead of verbose property listings.

5. Better array element type display: currently shows `object[]` for arrays of objects. Should show `{id, name, ...}[]` using the compact format to reveal the element shape inline.

</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the ML repos you can find online. for example test on karpathy's gpt-2 implementation.
please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, and keep the rest of mission.md the same.
