# Trunk Gateway

`@t3tools/gateway` exposes the provider subscriptions already configured in a running Trunk
server through an OpenAI-compatible HTTP API.

## Start

Create a Trunk bearer token with the `orchestration:read` and `orchestration:operate` scopes,
then run:

```sh
GATEWAY_API_KEY="your-client-facing-key" \
TRUNK_SERVER_URL="http://127.0.0.1:3000" \
TRUNK_SERVER_TOKEN="your-trunk-bearer-token" \
pnpm --dir apps/gateway start
```

Optional variables:

- `GATEWAY_HOST` defaults to `127.0.0.1`.
- `GATEWAY_PORT` defaults to `8787`.
- `GATEWAY_CWD` defaults to the Trunk server's working directory.

## API

Use `http://127.0.0.1:8787/v1` as the OpenAI base URL and pass `GATEWAY_API_KEY` as a Bearer
token.

Implemented endpoints:

- `GET /v1/models`
- `GET /v1/models/:model`
- `POST /v1/responses` (buffered and SSE streaming)
- `POST /v1/chat/completions` (buffered and SSE streaming)

Model IDs are namespaced as `<provider-instance>/<model-slug>`. An unqualified model slug is
also accepted when it identifies exactly one configured provider instance.

The initial gateway surface is text-only. Unsupported OpenAI request features (including tools,
audio, background responses, and continuation IDs) return structured OpenAI API errors rather
than being silently ignored. Trunk provider turns run in `full-access` mode within `GATEWAY_CWD`;
only expose the gateway to trusted callers and use the bearer key as a secret.
