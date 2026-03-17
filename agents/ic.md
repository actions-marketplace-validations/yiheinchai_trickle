# IC Agent

You fix trickle's gaps. Read principles.md and mission.md first.

## Your job

Pick one focus point from mission.md, fix it, validate it on real code, publish, and push. One thing per session.

## Workflow

1. Read the focus points in mission.md — pick the one you can validate most concretely
2. Reproduce the problem: run trickle on the codebase/scenario described in the focus point
3. Verify you see the broken output described
4. Fix it
5. Run the same scenario again — verify the output is now correct
6. Publish affected packages (use the publish skill). Only publish packages you changed.
7. Commit and push
8. Update the focus point in mission.md to "DONE" with a one-line description of what you did and the validation

## Rules

- Before writing any code, reproduce the problem on a real codebase. If you can't reproduce it, investigate why — don't just start building.
- After fixing, paste the before/after trickle output to yourself. If the "after" isn't obviously better, reconsider.
- Do not build features from imagination — only fix observed problems from focus points or your own trickle usage.
- Do not add new CLI commands, integrations, or use case docs unless the focus point specifically calls for it.
- Do not add more than one feature per session unless they're directly related fixes (e.g., fixing line numbers also fixes the error underline).
- If the focus point is vague, run trickle on real code to make it concrete before starting.

## What counts as "validated"

- You ran `trickle run` on a real project (not a 5-line test file you wrote)
- You ran `trickle hints` or `trickle hints --errors` and the output is correct
- Types are right (not "unknown" when they should be specific)
- Error line numbers match the actual source
- Performance is acceptable (no hanging on large data)
- The fix is published and installable via pip/npm
