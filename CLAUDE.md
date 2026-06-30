# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Cloudflare Worker (`glm-proxy`) that exposes an **OpenAI-compatible** API and reverse-proxies it to Cloudflare Workers AI's native OpenAI endpoint for the model `@cf/zai-org/glm-5.2`. Its purpose is to let OpenAI-compatible clients (specifically [opencode](https://opencode.ai)) talk to GLM-5.2 without holding the Cloudflare API token.

Deployed at `https://glm-proxy.changtimwu.workers.dev`.

## Commands

```sh
npm run dev      # wrangler dev — local server, reads secrets from .dev.vars
npm run deploy   # wrangler deploy
npm run tail     # wrangler tail — live logs (needs token scope "Workers Tail: Read")
```

There is **no test suite, linter, or build step** — `src/index.js` is plain ESM JavaScript deployed as-is by wrangler.

### Deploy environment

`wrangler` authenticates via two env vars, kept in `../cf.env` (one dir above the repo, never committed):

```sh
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' ../cf.env | cut -d= -f2- | tr -d '[:space:]')
export CLOUDFLARE_API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' ../cf.env | cut -d= -f2- | tr -d '[:space:]')
```

`CLOUDFLARE_ACCOUNT_ID` is **required** — the API token is account-scoped and cannot list accounts, so wrangler can't auto-detect it. For the same reason `GET /user/tokens/verify` returns `Invalid API Token` for this token even though it is valid; the successful `wrangler deploy` is the real check. Minimum token scopes: **Workers Scripts: Write** (deploy) + **Workers AI: Read** (inference).

### Secrets (runtime, set on the deployed Worker)

```sh
printf '%s' "<value>" | npx wrangler secret put CF_ACCOUNT_ID   # CF account id
printf '%s' "<value>" | npx wrangler secret put CF_API_TOKEN    # CF token with Workers AI access
printf '%s' "<value>" | npx wrangler secret put PROXY_TOKEN     # shared bearer clients must present
```

For local `wrangler dev`, put the same three keys in `.dev.vars` (copy `.dev.vars.example`).

## Architecture

The whole Worker is `src/index.js`. Request flow:

```
client ──Bearer PROXY_TOKEN──▶ Worker ──Bearer CF_API_TOKEN──▶ api.cloudflare.com/.../ai/v1/...
```

- **Auth swap (the core idea):** clients authenticate with `PROXY_TOKEN`; the Worker validates it (constant-time compare) and replaces it with the real `CF_API_TOKEN` before forwarding. The Cloudflare token never leaves the Worker.
- **Path mapping:** any `/v1/*` request is forwarded to `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1/*`. `/` and `/health` return status JSON; everything else 404s.
- **Why a passthrough proxy, not the `env.AI` binding:** the binding returns Workers AI's *native* response shape, which would have to be re-mapped to OpenAI format (tool_calls, SSE deltas). Forwarding to Cloudflare's OpenAI-compatible endpoint makes Cloudflare do that conversion, so streaming and **function-calling stay byte-for-byte correct** — essential because the consuming agent (opencode) depends on tool calls. Preserve this design; do not switch to the AI binding without re-implementing format conversion.
- The upstream response body is streamed straight back (preserves SSE for `stream: true`).

`@cf/zai-org/glm-5.2` is a **reasoning** model: responses carry a `reasoning_content` field and consume output tokens while thinking, so callers need a generous `max_tokens`.

## Consumer (out of repo)

opencode reads `~/.config/opencode/opencode.json`, which defines a `cf-glm` provider (`@ai-sdk/openai-compatible`) pointing `baseURL` at this Worker's `/v1` and presenting `PROXY_TOKEN` as the API key. The model is referenced as `cf-glm/@cf/zai-org/glm-5.2`. If the Worker URL or `PROXY_TOKEN` changes, update that file too.
