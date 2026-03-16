Think of 1 item to work to improve the developer experience with trickle.

For now, i want you to specifically focus on:
<higher directive>
Trickle has completed three chapters: "see everything" (all 4 agent frameworks, LLM/MCP tracing, causal debugging), "catch every mistake" (evals, run diffing, silent failure detection, per-agent cost), and "prove it's safe" (security scanning, compliance audit export, CI/CD eval gating). The next chapter: "meet developers where they are." 57% of companies have agents in production, but a single AI agent generates 10-100x more observability data than traditional apps — teams are hitting $150K/month on cloud monitoring. Trickle's local-first approach eliminates this cost entirely. Meanwhile, IDE-native observability is the clear trend: Honeycomb built MCP for Cursor, Datadog shipped Code Insights for VS Code, and developers want runtime insights without leaving their editor. Trickle already has a VSCode extension + 37 MCP tools — the infrastructure exists. Three pillars: (1) IDE-native runtime insights — surface eval scores, security alerts, cost data, and agent traces inside VS Code and Cursor via trickle's existing MCP server and VSCode extension. (2) Smart data management — agents produce massive telemetry; add intelligent sampling, retention policies, and summarization so trickle stays fast even on heavy workloads. (3) Model tier observability — as enterprises use tiered inference (80% cheap model, 20% frontier for 75% cost savings), they need to see which tier handled what and whether quality held. Every feature must pass: "does this surface the right insight, in the right place, at the right time, with zero cost and zero setup?"
</higher directive>

<focus point>
CLI 0.1.197, client-js 0.2.121, client-python 0.2.34, VSCode 0.1.68. 38 MCP tools. Four chapters complete: see everything, catch every mistake, prove it's safe, meet developers where they are.

Full stack verified end-to-end on real Express blog API (378 vars, 70 functions, 60 call traces — all 11 commands pass). Every shipped feature works in production conditions.

Priority areas for next chapter — "scale and distribute":

1. **Real-world agent testing** — test trickle on REAL agent codebases (a LangChain RAG app, a CrewAI multi-agent crew, a production Express+OpenAI app). Fix every issue found. Current testing used mocks/simulations; real agent workloads will surface edge cases in hook injection, data volume, and framework version compatibility.

2. **VSCode extension: CodeLens for costs** — show per-function LLM cost inline in the editor. When a function calls OpenAI, show "$0.003 (gpt-4o, 500 tokens)" as CodeLens above the function. This surfaces the most actionable insight (cost) in the most natural place (the code).

3. **Trace summarization** — agents produce 100s of events per run. Add `trickle summarize` that compresses verbose traces into key decision points: "Agent called 5 tools, 3 LLM calls ($0.02), finished in 5s — key decision: chose search_docs over browse_web because..." This makes agent traces actionable without reading every event.

4. **Distribution** — README improvements, npm/PyPI package descriptions, example repos, blog posts. Trickle has a massive feature set but no marketing. The best tool nobody knows about doesn't win.

5. **Performance on large datasets** — stress-test trickle with 10K+ observations, 1K+ LLM calls. Profile and optimize any bottlenecks in CSV export, dashboard rendering, eval scoring, cost-report.
</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. if you are unsure what to work on, test trickle on a real world codebase js/ts/python and see what pain points you experience, and then work on that.

before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the repos you can find online. for example ML you can test on karpathy's gpt-2 implementation. for react ts, find a react repo online. the key is you must try to search for a variety of real world codebases relevant to your chanfe to test it to ensure it has real world value.

please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing, only publish packages affect by your change). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, the focus points should follow the general directive, and keep the rest of mission.md the same.

DO NOT ever believe that trickle is done, it is not. If focus point says all done, delete all text within focus point and come up with ideas that follows the directive.
