# Railway Deploy Migration — Session Summary

Context for the next agent continuing work on this repo.

## What this repo is

Fork of [lukilabs/craft-agents-oss](https://github.com/lukilabs/craft-agents-oss), deployed as a headless Craft Agents server on Railway with a Steel Browser sidecar. Repo is hosted at `hellogafaro/hellogafaro-code` on GitHub. `main` branch is the single source of truth.

Upstream tracking via `upstream` remote:
```
git remote add upstream https://github.com/lukilabs/craft-agents-oss.git  # already set
git fetch upstream
git merge upstream/main   # weekly sync
git push origin main      # Railway auto-builds
```

## Live infrastructure

Railway project: `hellogafaro-code`. Two services:

| Service | Purpose | Source |
|---|---|---|
| `hellogafaro-code` | Craft Agents headless server + WebUI | GitHub repo, `Dockerfile.server`, auto-deploy on push |
| `hellogafaro-code-browser` | Self-hosted Steel Browser | Docker image `ghcr.io/steel-dev/steel-browser:latest`, internal-only |

Domain: `code.ongafaro.com` → `hellogafaro-code` service (port 9100).

Volume: `hellogafaro-code-volume` mounted at `/home` on `hellogafaro-code`. Whole user home persisted.

Container user: `hellogafaro` (non-root, because Claude Agent SDK refuses to run as root).

Internal DNS: `hellogafaro-code-browser.railway.internal:8080` (Steel API) / `:9222` (CDP).

## Volume layout

```
/home/
├── hellogafaro/                     ← user home, persisted
│   ├── .craft-agent/                ← 610MB, workspaces/sessions/credentials/sources
│   └── projects/                    ← empty, ready for cloned repos or agent work
└── lost+found/                      ← volume artifact, ignore
```

Railway env vars on `hellogafaro-code`:
```
CRAFT_SERVER_TOKEN=...                        (bearer for thin-client auth)
CRAFT_WEBUI_PASSWORD=...                      (shorter password for WebUI login)
CRAFT_WEBUI_WS_URL=wss://code.ongafaro.com
CRAFT_WEBUI_SECURE_COOKIE=true
CRAFT_RPC_HOST=0.0.0.0
CRAFT_RPC_PORT=9100
PORT=9100                                     (Railway target port hint)
STEEL_BASE_URL=http://hellogafaro-code-browser.railway.internal:8080
STEEL_CDP_BASE=ws://hellogafaro-code-browser.railway.internal:9222
```

## Commits made this session (on `main`)

- `5f9bcb7` Initial scaffold for Craft Agents OSS deploy on Railway (pre-session)
- `477a89d` Merge `upstream/main` — brings in full craft-agents-oss source
- `a84568b` Fork overlay: build from Dockerfile.server + Steel Browser wiring
- `5e86d56` Fix build: drop non-existent `apps/marketing` reference
- `90fcc2a` Fix build: drop `packages/craft-cli`, `packages/craft-agents-commands` refs + loosen lockfile
- `37f2e1a` Clear stale `.server.lock` on startup
- `b7fc1b3` TopBar: drop macOS stoplight padding on web
- `60a2c8e` Rename container user `craftagents` → `hellogafaro` + add AGENTS.md

## Gafaro-specific patches in this fork

Scoped to minimize upstream merge conflicts:

1. `Dockerfile.server` — patched lines:
   - `jq` added to apt install (needed by steel wrapper)
   - `bun add -g @playwright/mcp@latest` after `bun install`
   - `COPY scripts/steel-pw-mcp.sh /usr/local/bin/steel-pw-mcp` + chmod
   - Removed `COPY apps/marketing/package.json`, `packages/craft-cli/package.json`, `packages/craft-agents-commands/package.json` (not published to OSS)
   - Changed `bun install --frozen-lockfile` → `bun install` (lockfile has phantom workspace refs)
   - User/group/home renamed `craftagents` → `hellogafaro`
   - `ENTRYPOINT` wraps `bun run` with `rm -f /home/hellogafaro/.craft-agent/.server.lock` and adds `--allow-insecure-bind`
2. `railway.toml` — `dockerfilePath = "Dockerfile.server"`
3. `scripts/steel-pw-mcp.sh` — new wrapper: creates Steel session → execs Playwright MCP with `--cdp-endpoint` → releases session on exit. Supports both self-hosted (via `STEEL_BASE_URL`) and Steel cloud (via `STEEL_API_KEY`).
4. `apps/electron/src/renderer/components/app-shell/TopBar.tsx` — `menuLeftPadding` = 12 on web (was 86 macOS-only, wasted in browser).
5. `AGENTS.md` at repo root (project rules).
6. `CLAUDE.md` → symlink to `AGENTS.md`.

## Sync upstream workflow

```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts on Dockerfile.server if upstream touched it.
# Other Gafaro files (scripts/, AGENTS.md, TopBar.tsx tweak) rarely collide.
git push origin main
# Railway auto-builds.
```

## TODO

### Immediately actionable
- [ ] **WebUI: add Playwright MCP as source** — Sources → Add MCP (stdio), command `steel-pw-mcp`, no args. Connects to self-hosted Steel browser.
- [ ] **WebUI: disable built-in `browser_tool`** — Settings → Tools → toggle off. Forces agent to use Playwright MCP source.
- [ ] **Smoke test browser** — in a new session: "open example.com and screenshot". Should succeed end-to-end via Steel.

### Open questions / decisions
- [ ] Clone lost projects from GitHub into `/home/hellogafaro/projects/`? Project `hellogafaro-agents` was at `/home/craftagents/projects/` on the old container (ephemeral, not backed up). Not recoverable from tar backup. If repo exists on GitHub, reclone.
- [ ] Old chat sessions fail with "Claude Code executable not found at /app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js". File exists on new image (13MB), new sessions work, old sessions reference stale paths from pre-migration image. Options: live with it; delete old session state; investigate `@anthropic-ai/claude-agent-sdk` resolution for persisted sessions.
- [ ] Publish a Railway template ("Deploy Craft Agents + Steel Browser on Railway") — dashboard action once satisfied with setup.

### Nice-to-have
- [ ] Add CI/linting (GitHub Actions) for PRs before they hit Railway.
- [ ] Set up scheduled volume backups (cron / GH Action that `railway ssh`'s in and tars `/home/hellogafaro/.craft-agent/` to S3/R2).
- [ ] UI additions user mentioned: terminal view in the WebUI, other UI fixes.
- [ ] Consider Railway volume snapshot tier if Pro plan; otherwise manual tar backups.

## Things that MUST NOT happen again

1. **Don't detach the volume while the container is running and writing**. Craft's `.server.lock` file gets written on boot; stale lock file = crashloop. Already handled in entrypoint (`rm -f .server.lock` before bun), but keep in mind.
2. **Don't mount a volume at `/` or `/app`** — masks container FS, container dies.
3. **Don't push to `main` without testing locally if the change touches `Dockerfile.server`** — broken Dockerfile breaks Railway deploys.
4. **Don't assume ephemeral data is persisted** — only `/home/` is on the volume. Anything elsewhere (`/tmp`, `/app`, `/var`) is ephemeral.

## Known lessons from this session

- Railway CLI `redeploy` uses cached snapshot, does NOT re-pull from GitHub. Use `railway up` to push local state, or just `git push` (GitHub source auto-build).
- Railway CLI domain commands throw 401 for mutations — use dashboard for domain add/remove.
- Railway volume mount path changes ARE allowed and preserve data; just update the mount point.
- `railway ssh` runs as root inside container (sudo access), not as `hellogafaro`.
- Binary streams over `railway ssh` get PTY-mangled; use base64 encode/decode for tar transfers.
- Upstream `Dockerfile.server` references several packages not in the OSS repo (`apps/marketing`, `packages/craft-cli`, `packages/craft-agents-commands`). They're in their private monorepo, stripped at OSS publish time. We removed those lines; expect to resolve merge conflicts each sync.

## Backups

- `~/Downloads/craft-agent-pre-fork-20260423-1932.tar.gz` (215MB, 16,153 files) — full snapshot of `.craft-agent/` before migration. Has `jackfir-shopify-theme` project nested in workspace.

## Quick commands for the next agent

```bash
# Project state
git log --oneline -10
git remote -v
railway status
railway variables --service hellogafaro-code

# SSH in
railway ssh --service hellogafaro-code

# Deploy a change
git commit ...
git push origin main
# Railway auto-builds; watch with:
railway logs --service hellogafaro-code --build

# Sync upstream
git fetch upstream
git merge upstream/main
git push origin main
```

## File map of Gafaro-specific changes

```
Dockerfile.server                                            (patched)
railway.toml                                                 (patched)
scripts/steel-pw-mcp.sh                                      (new)
apps/electron/src/renderer/components/app-shell/TopBar.tsx   (2-line patch)
AGENTS.md                                                    (new, project rules)
CLAUDE.md                                                    (symlink → AGENTS.md)
docs/plans/railway-migration.md                              (this file)
TODO.md                                                      (active todos)
```
