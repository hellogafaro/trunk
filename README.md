# Trunk

Trunk is a web-only interface for coding agents. It uses Synara as its upstream engine while
keeping the product focused on the browser and server: there is no Electron desktop application
or marketing site in this fork.

Trunk supports the provider integrations inherited from Synara. Chats, projects, and history
remain local to the server through Synara's existing `.synara` storage and `SYNARA_*`
configuration.

## Requirements

- [Bun](https://bun.sh/) 1.3.12 or newer in the supported 1.3 line
- Node.js 24.13.1 or newer in the supported 24.x line
- At least one installed and authenticated coding-agent provider

For example, install the [Codex CLI](https://developers.openai.com/codex/cli) and run
`codex login`, or install [Claude Code](https://claude.com/product/claude-code) and run
`claude auth login`.

## Run from source

```bash
bun install
bun run dev
```

`bun run dev` starts the web application and server together. The focused development commands
are `bun run dev:web` and `bun run dev:server`.

For a production build:

```bash
bun run build
bun run start
```

## Quality checks

```bash
bun run fmt
bun run lint
bun run typecheck
bun run test
```

Browser tests live in `apps/web`; CI runs the stable browser suite before building the web and
server packages.

## Upstream

Trunk is a fork of [Synara](https://github.com/Emanuele-web04/synara) and retains Synara's
internal package names, protocols, persistence formats, and provider integrations to keep normal
`upstream/main` merges straightforward. Synara is Copyright (c) 2026 Emanuele Di Pietro and is
used under the MIT License.

See [WEB_PARITY.md](./WEB_PARITY.md) for native capabilities that may eventually be migrated to
server-backed web features.

## License

Trunk and the upstream Synara code are available under the [MIT License](./LICENSE).
