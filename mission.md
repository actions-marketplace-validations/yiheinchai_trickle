Think of 1 item to work to improve the developer experience with trickle.

For now, i want you to specifically focus on:
<higher directive>
Trickle's strategic moat is zero-code, local-first runtime observability for both humans AND AI agents — at zero cost. The market has three openings: (1) a cost revolt against Datadog/New Relic ($50K-$1M/year), (2) 10,390+ MCP servers with no observability standard, and (3) LangSmith locked to LangChain while CrewAI, OpenAI Agents SDK, and Microsoft Agent Framework all need framework-agnostic observability. Trickle's positioning: the Switzerland of agent observability — works with every framework, every LLM provider, every IDE agent. Three strategic pillars: (1) MCP-native observability — be the default way AI coding agents understand runtime behavior; 10K+ MCP servers generate traces that need capturing, and trickle's MCP server already feeds context back to agents. (2) Framework-agnostic agent tracing — trace LangChain, CrewAI, OpenAI Agents SDK, and custom agents with zero code changes, owning the space LangSmith can't reach. (3) Vibe-coder DX — zero-config, single-line setup, instant results; 45% of AI-generated code has security vulnerabilities, and developers building with AI need observability that's as fast as their workflow. Every feature must pass: "does this make a developer (or their AI agent) understand running code faster, with zero setup friction?"
</higher directive>

<focus point>
CLI 0.1.180, client-js 0.2.121, client-python 0.2.30. SHIPPED: MCP tool call tracing, .pyi stub quality fix, live status display, Gemini auto-instrumentation.

Just shipped: **MCP tool call auto-instrumentation** — zero-code capture of MCP tool invocations for both @modelcontextprotocol/sdk (JS) and mcp (Python). Captures tool name, arguments, response preview, latency, errors, and direction (outgoing client calls + incoming server handlers). Writes to .trickle/mcp.jsonl. CLI has `trickle mcp-calls` command. Dashboard/CSV export include MCP data. Live status shows MCP call count.

This makes trickle the first observability tool with built-in MCP tracing — positioning it at the center of the 10K+ MCP server ecosystem.

Priority areas:
1. **Framework-agnostic agent tracing** — zero-code auto-detection of LangChain/CrewAI/OpenAI Agents SDK workflows
2. **Agent execution graph visualization** — visual node-based graph in dashboard showing LLM→tool→agent flow
3. **WebSocket dashboard streaming** — real-time browser updates for long-running processes
4. **More LLM providers** — Cohere, Mistral AI for broader coverage
</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. if you are unsure what to work on, test trickle on a real world codebase js/ts/python and see what pain points you experience, and then work on that.

before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the repos you can find online. for example ML you can test on karpathy's gpt-2 implementation. for react ts, find a react repo online. the key is you must try to search for a variety of real world codebases relevant to your chanfe to test it to ensure it has real world value.

please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing, only publish packages affect by your change). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, the focus points should follow the general directive, and keep the rest of mission.md the same.

DO NOT ever believe that trickle is done, it is not. If focus point says all done, delete all text within focus point and come up with ideas that follows the directive.
