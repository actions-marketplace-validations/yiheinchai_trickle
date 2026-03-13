Think of 1 item to work on ML engineer user case to improve the developer experience.

For now, i want you to specifically focus on:
<general directive>
Improve on the python developer experience, any arbituary python code (even without framework) can be run and instantly generate inline type hints
</general directive>

<focus point>

Next priorities for Python DX:

1. **Zero-config VSCode inline hints for arbitrary Python scripts** — Test on diverse real-world Python repos (Django apps, FastAPI, data processing scripts, Karpathy's GPT-2, etc.). Verify the full loop: `import trickle.auto` → run → open file in VSCode → see inline hints. Fix any gaps (data not flushed, hints not appearing, edge cases with generators/properties/class methods/decorators).

2. **`trickle python setup` CLI command** — Similar to `trickle rn setup` and `trickle next setup`: print step-by-step setup instructions for the Python experience (install, choose approach A/B/C, open VSCode, see hints).

3. **Type hints in terminal output** — For scripts run via `trickle run python script.py`, print a summary of inferred types to stdout after the script finishes (similar to `printObservations()` for Lambda). This makes the experience "instant" without needing VSCode at all.

</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. if you are unsure what to work on, test trickle on a real world codebase js/ts/python and see what pain points you experience, and then work on that.

before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the repos you can find online. for example ML you can test on karpathy's gpt-2 implementation. for react ts, find a react repo online. the key is you must try to search for a variety of real world codebases relevant to your chanfe to test it to ensure it has real world value.


please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing, only publish packages affect by your change). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, the focus points should follow the general directive, and keep the rest of mission.md the same.
