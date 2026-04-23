# TODO

Active work items. See `docs/plans/railway-migration.md` for full context.

## Immediate (do in Craft Agents WebUI)
- [ ] Add Playwright MCP as a source: Sources → Add MCP (stdio), command `steel-pw-mcp`. Connects to self-hosted Steel Browser at `hellogafaro-code-browser.railway.internal`.
- [ ] Disable built-in `browser_tool`: Settings → Tools → toggle off.
- [ ] Smoke test: new session, "open example.com and screenshot".

## Open
- [ ] Old chat sessions fail on Claude Code CLI resolution (new sessions work). Investigate if worth fixing or just archive old sessions.
- [ ] Reclone any still-needed projects into `/home/hellogafaro/projects/` (old `hellogafaro-agents` folder was ephemeral, lost; if repo exists on GitHub, reclone via `railway ssh` + `gh repo clone`).
- [ ] Publish Railway template for the stack (dashboard action).

## Nice-to-have
- [ ] GitHub Actions CI before Railway build (typecheck, maybe test).
- [ ] Scheduled volume backup (cron job tar's `/home/hellogafaro/.craft-agent/` to S3/R2).
- [ ] UI additions: terminal view in WebUI, other UI tweaks user mentioned.

## Done this session
- [x] Forked upstream into this repo, merged full source
- [x] Patched `Dockerfile.server` for Railway + Steel wiring
- [x] Stood up `hellogafaro-code-browser` (self-hosted Steel) as sibling Railway service
- [x] Migrated volume from old service to new GitHub-connected service
- [x] Renamed container user `craftagents` → `hellogafaro`
- [x] Changed volume mount path to `/home` (whole home persisted)
- [x] Restored data into correct `/home/hellogafaro/.craft-agent/` layout
- [x] Fixed TopBar padding for web
- [x] Added AGENTS.md + CLAUDE.md symlink
