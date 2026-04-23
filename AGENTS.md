## Core behavior
- Do not act without sufficient context
- Execute or ask one precise clarifying question
- Do not argue with the user
- Prefer correct over complete
- Prefer simple over clever
- Practice KAIZEN, improve continuously through small verified steps
- Practice YAGNI, do not build what is not needed now

## Workflow routing
- Use a defined workflow before ad hoc execution when the task is multi-step or ambiguous
- Brainstorm before design-changing work
- Plan before multi-step implementation
- Review before declaring non-trivial work done
- Do not implement before the request, scope, and success criteria are clear enough

## Context discipline
- Read only what is necessary
- Do not reread unchanged files
- Prefer targeted reads over full files
- Cache file contents and intermediate results
- Avoid loading large files fully into context
- Prefer durable project artifacts over chat history

## Project artifacts
- Durable documentation lives under `docs/`
- Specs live in `docs/specs/`
- Plans live in `docs/plans/`
- Keep structure minimal, do not add new doc categories without reason
- Treat plans as proposals, not truth; verify against the current code before acting
- If shared task tracking is needed, use `TODO.md` at the repo root

## Cross-agent handoff
- Use repository files, not hidden session memory, as the source of truth
- A new agent must be able to continue from `AGENTS.md`, `TODO.md`, and the relevant docs/code
- Handoffs must reference exact files
- Do not rely on prior chat context when durable artifacts can carry the state

## Output discipline
- Keep responses extremely concise
- No filler, praise, hedging, or narration
- Lead with the answer or fix
- Do not restate the problem
- Prefer bullets, commands, or diffs over prose

## Code rules
- Do not rewrite entire files unless required
- Make minimal diffs only
- Follow existing patterns and structure
- Prefer simple solutions over abstractions
- Do not introduce new dependencies without reason
- One domain per file, split unrelated responsibilities
- Do not assume old architecture notes are still current without verifying in code

## Naming

### Files and directories
- Use `kebab-case` for all files and directories
- Filename matches primary export when practical
- One domain per file; split unrelated responsibilities

### Variables and functions
- Use `camelCase` for variables, functions, and methods
- Use `PascalCase` for types, interfaces, and classes
- Use `SCREAMING_SNAKE_CASE` for constants
- Keep names short and direct
- No redundant type in names
- Use `row` for a single db result, plural for collections

### CRUD operations
- Read one: `get` + singular
- Read many: `get` + plural
- Create or upsert: `upsert` + singular
- Update: `update` + singular
- Delete: `delete` + singular
- Never use bare verbs, always `verb` + domain noun
- Never use `list`, use `get` + plural
- Never use `remove`, use `delete`
- Prefer one `get` per domain with optional lookup fields instead of `getBy*` variants
- Prefer one `update` per domain with `id` plus optional partial fields

### Non-CRUD prefixes
- `handle` for entry points from webhooks and external events
- `format` for data transformed for display
- `on` for side-effect reactions
- `has` or `is` for boolean checks

## Code style

### Functions
- Use a single return shape; do not mix `null` and `undefined` unless needed
- Prefer early returns over nested conditionals
- Max one level of callback nesting
- Prefer one function with options over redundant granular variants
- Return objects directly with a consistent shape

### Types
- Use `interface` for public contracts
- Use `type` for unions and utilities
- Do not use `any`; use `unknown` and narrow it

### Comments
- Add JSDoc only for exported functions when the intent is not obvious
- Keep JSDoc to one sentence
- No inline comments unless logic is truly non-obvious
- No numbered step comments

### Error handling
- Throw descriptive errors in library code
- Catch and format errors at route, action, or command boundaries
- Use `try/catch` where failure needs controlled formatting or recovery

### Logging
- Always use structured logging
- Never use ad hoc `console.log` for application logs

## Validation
- Validate before declaring done
- Ensure code runs or compiles if applicable
- Verify logic matches the request
- Review non-trivial work before marking it complete
- Surface uncertainty briefly if needed

## Failure handling
- Do not loop blindly on failures
- Retry only if safe
- Escalate clearly when blocked
- Stop early if uncertain instead of guessing

## Git

### Commits
- Use conventional commits: `type: short description`
- Types: `feat` `fix` `chore` `refactor` `docs` `test` `style`
- Scope optional: `feat(reports): add export action`
- Subject line max 72 chars
- No body unless the why is non-obvious

### Pull requests
- Title: same format as commit
- Body: bullet points of what changed, one line each
- No prose framing
- Reference issue if one exists
- Max 3 to 5 bullets

### Branches
- `feat/short-slug`
- `fix/short-slug`
- `chore/short-slug`

## Communication style
- Be terse, direct, and technical
- Remove all filler language
- Use the minimum words needed for correctness

## Local notes
- Do not assume Convex is active in this app just because older docs or generated files mention it
- Verify the current stack from the codebase before following legacy instructions
