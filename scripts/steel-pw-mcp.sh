#!/usr/bin/env bash
# Wrapper: create a Steel browser session, exec Playwright MCP against its CDP
# endpoint, release the session on exit.
#
# Works with either:
#   - Self-hosted Steel (default): STEEL_BASE_URL=http://<host>:3000, no API key.
#   - Steel cloud:                 STEEL_BASE_URL=https://api.steel.dev + STEEL_API_KEY set.
set -euo pipefail

STEEL_BASE_URL="${STEEL_BASE_URL:-http://hellogafaro-code-browser.railway.internal:3000}"
STEEL_CDP_BASE="${STEEL_CDP_BASE:-ws://hellogafaro-code-browser.railway.internal:3000}"
SESSION_TIMEOUT_MS="${STEEL_SESSION_TIMEOUT_MS:-900000}"

AUTH_HEADER=()
CDP_QS=""
if [ -n "${STEEL_API_KEY:-}" ]; then
  AUTH_HEADER=(-H "Steel-Api-Key: ${STEEL_API_KEY}")
  CDP_QS="apiKey=${STEEL_API_KEY}&"
fi

SID=$(curl -fsS -X POST "${STEEL_BASE_URL}/v1/sessions" \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"timeout\": ${SESSION_TIMEOUT_MS}}" | jq -r .id)

if [ -z "${SID}" ] || [ "${SID}" = "null" ]; then
  echo "steel-pw-mcp: failed to create Steel session at ${STEEL_BASE_URL}" >&2
  exit 1
fi

cleanup() {
  curl -fsS -X POST "${STEEL_BASE_URL}/v1/sessions/${SID}/release" \
    "${AUTH_HEADER[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

exec bunx -y @playwright/mcp@latest \
  --cdp-endpoint "${STEEL_CDP_BASE}?${CDP_QS}sessionId=${SID}" \
  "$@"
