Think of 1 item to work to improve the developer experience with trickle.

For now, i want you to specifically focus on:
<higher directive>
Create the best documentations to ever exist. Currently documentation is very outdated, and old. Each usecase needs to be updated. Build the documentation for both humans and for AI agents.

document is atrocious. i had a backend nodejs developer (aws lambdas) trying to run a vitest. no idea what to do. documentation is no good enough if real users don't even know what to do and how to use trickle

this is just an example, you need to follow through and empathise with the user in the customer journey and think about each piece of information they need
</higher directive>

<focus point>
Docs rewrite complete for core usecases:
- README: backend section now shows debugging/testing first, AI agent section shows 26 MCP tools
- ai-agent.md: complete rewrite (8 use cases, on-call loop, all 26 tools)
- javascript-developer.md: vitest/jest testing with 3 options
- backend-api-developer.md: debugging, testing, verification use cases added
- python-developer.md: debugging/observability quick start at top
- fullstack-developer.md: debugging quick start added

Remaining docs to review: qa-engineer.md, devops-ci.md, legacy-codebase.md,
react-developer.md, nextjs-developer.md, react-native-developer.md
</focus point>

this is just an example, please look at usecases directory for the customer journey and add
to it as required by empathising with the user / audience. if you are unsure what to work on, test trickle on a real world codebase js/ts/python and see what pain points you experience, and then work on that.

before you start work, please pull from remote. Once
you have a feature that you think will be useful to add, implement it in
full, please test on real code in the repos you can find online. for example ML you can test on karpathy's gpt-2 implementation. for react ts, find a react repo online. the key is you must try to search for a variety of real world codebases relevant to your chanfe to test it to ensure it has real world value.

please commit and push once that piece of work is completed and fully working. then, please use the publish-skill to publish (if it is code you are changing, only publish packages affect by your change). if you encounter any issues and you managed to resolve them, please use the create-skill skill to make a skill so you can do it smoothly next time. moreover, if you changes enable new use cases, please modify the use cases in the usecases directory. lastly, if you have identified an area that trickle is weak in and should be worked on, please modify mission.md accordingly, you should only modify the text within the <focus point> tags, the focus points should follow the general directive, and keep the rest of mission.md the same.

if you think everything has already be accomplished, please compact conversation, and work on improving trickle by your discretions
