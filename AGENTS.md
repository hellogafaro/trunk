# AGENTS.md

Guidance for human and AI contributors working on Trunk.

## Product Direction

Trunk is an AI operations hub for teams that run on Notion and Slack.

- Notion is the source of truth for tasks, projects, clients, meetings, content, and final outputs.
- Slack is the communication, command, and approval layer.
- Agents are durable domain workers with their own role, instructions, tools, memory, and activity history.
- Routines are prompt-based automations, similar to Claude routines.
- Runs are traceable executions with live status, logs, outputs, approvals, and linked Notion records.
- Claude Code and Codex CLI are the primary execution runtimes.

## Product Principles

- Keep the UX simple: create agents, create routines, watch runs, approve actions, inspect history.
- Prefer domain-worker agents such as PM, SEO, Sales, Support, Content, and Personal EA.
- Let agents write internal state automatically, but require approval for external sends, publishing, spend, and destructive actions.
- Keep important facts and final business state in Notion. Do not create hidden sources of truth.
- Keep Slack interactions useful: mentions, commands, approvals, summaries, and follow-ups.
- Preserve resumability where possible. A run should be easy to continue, inspect, retry, pause, or cancel.

## Engineering Principles

- Prefer boring, reliable infrastructure and small, reversible changes.
- Keep upstream compatibility in mind; avoid unnecessary rewrites that make future Paperclip merges painful.
- Remove or hide unused upstream surface area before adding new abstractions.
- Do not add integrations, adapters, or workflow complexity before a concrete routine needs them.
- Keep behavior predictable under failures: retries, partial runs, reconnects, duplicate webhooks, and approval timeouts.
- Treat logs, approvals, and run state as product features, not debugging leftovers.
- Prefer correctness and robustness over short-term convenience.
- Avoid duplicate logic. Extract shared behavior when it reduces real complexity.
- Practice YAGNI: do not build what is not needed now.

## Contribution Rules

- Read existing code before changing it.
- Follow local patterns unless there is a clear reason to simplify them.
- Keep contracts synchronized when behavior crosses API, database, worker, and UI boundaries.
- Validate changes with the smallest relevant checks first, then broader checks when the scope warrants it.
- Report what was verified and what was not.
- Do not keep stale architecture notes, fork notes, or setup instructions in this file.
- Do not act without sufficient context. Ask one precise question when the request, scope, or success criteria are unclear.
- Prefer targeted reads and searches over loading large files.
- Prefer durable repo artifacts over hidden chat memory for plans, specs, and handoffs.

## Code Rules

- Make minimal diffs. Do not rewrite entire files unless required.
- Follow existing patterns and structure before adding new abstractions.
- Do not introduce dependencies without a concrete need.
- Keep one domain per file and split unrelated responsibilities.
- Verify current code before trusting old architecture notes.

## Naming

- Use `kebab-case` for files and directories.
- Use `camelCase` for variables, functions, and methods.
- Use `PascalCase` for types, interfaces, and classes.
- Use `SCREAMING_SNAKE_CASE` for constants.
- Keep names short and direct. Avoid redundant type words.
- Use `row` for one database result and plural names for collections.
- CRUD names should be explicit: `get`, `upsert`, `update`, `delete` plus the domain noun.
- Prefer `get` plus optional lookup fields over many `getBy*` variants.
- Use `handle` for webhook/external entry points, `format` for display transforms, `on` for side-effect reactions, and `has` or `is` for boolean checks.

## Code Style

- Prefer early returns over nested conditionals.
- Use a single return shape. Do not mix `null` and `undefined` unless necessary.
- Keep callback nesting to one level.
- Prefer one function with options over many redundant granular variants.
- Return objects directly with a consistent shape.
- Use `interface` for public contracts and `type` for unions/utilities.
- Do not use `any`; use `unknown` and narrow it.

## Comments, Errors, And Logs

- Add JSDoc only for exported functions when intent is not obvious.
- Keep comments rare and useful. No numbered step comments.
- Throw descriptive errors in library code.
- Catch and format errors at route, action, command, or worker boundaries.
- Use structured logging. Do not use ad hoc `console.log` for application logs.

## Validation And Failure Handling

- Validate before declaring work done.
- Ensure code runs or compiles when applicable.
- Review non-trivial work before handing it off.
- Do not loop blindly on failures.
- Retry only when safe.
- Escalate clearly when blocked.

## Git And Handoffs

- Use conventional commits: `type: short description`.
- Keep commit subjects under 72 characters.
- Use no commit body unless the why is non-obvious.
- PR titles should match the commit style.
- PR bodies should use short bullets for what changed, verification, and risks.
- Do not rewrite history, reset, or revert unrelated changes without explicit instruction.
- Handoffs should reference exact files and current verification status.

## Communication

- Be terse, direct, and technical.
- Lead with the answer or fix.
- Avoid filler, hedging, and restating the problem.
- Prefer bullets, commands, or diffs over long prose.

## Out of Scope Unless Explicitly Needed

- Coding-IDE features.
- Marketplace/social/wallet features.
- Visual workflow builders.
- Broad multi-adapter support beyond Claude Code and Codex CLI.
- Replacing Notion as the business database.
- Replacing Slack as the collaboration layer.
