#!/usr/bin/env bash
#
# Example client for the glm-proxy Worker — checks whether a PROXY_TOKEN is
# accepted by sending one minimal OpenAI-style chat request.
#
#   HTTP 200 -> token valid
#   HTTP 401 -> token rejected
#
# (Cache hits aren't reported in the response on the api.cloudflare.com REST
# path — see them in the AI Gateway logs/dashboard instead.)
#
# Usage:
#   PROXY_TOKEN=xxxx ./examples/check-token.sh
#   ./examples/check-token.sh <proxy-token>
#   PROXY_URL=https://my-worker.workers.dev ./examples/check-token.sh <proxy-token>
#
set -euo pipefail

BASE_URL="${PROXY_URL:-https://glm-proxy.changtimwu.workers.dev}"
TOKEN="${1:-${PROXY_TOKEN:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "error: no token. Set PROXY_TOKEN or pass it as the first argument." >&2
  exit 2
fi

body="$(mktemp)"
trap 'rm -f "$body"' EXIT

code="$(curl -sS -o "$body" -w '%{http_code}' \
  -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"model":"@cf/zai-org/glm-5.2","messages":[{"role":"user","content":"Reply with: ok"}],"max_tokens":16}')"

echo "POST $BASE_URL/v1/chat/completions -> HTTP $code"

case "$code" in
  200) echo "✅ token valid" ;;
  401) echo "❌ token rejected (401 Unauthorized)"; exit 1 ;;
  *)   echo "⚠️  unexpected status — response body:"; cat "$body"; echo; exit 1 ;;
esac
