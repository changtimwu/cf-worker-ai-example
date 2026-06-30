# glm-proxy

A tiny Cloudflare Worker that exposes an **OpenAI-compatible** endpoint and
forwards to Cloudflare Workers AI's [`@cf/zai-org/glm-5.2`](https://developers.cloudflare.com/workers-ai/models/glm-5.2/)
(Z.ai's flagship agentic coding model — 262K context, function calling).

It forwards to Cloudflare's native OpenAI-compatible endpoint
(`/accounts/{id}/ai/v1/...`) rather than the AI binding, so streaming and
tool-calling stay byte-for-byte OpenAI-shaped — which is what agentic clients
like [opencode](https://opencode.ai) expect.

```
opencode  ──Bearer PROXY_TOKEN──▶  glm-proxy Worker  ──Bearer CF_API_TOKEN──▶  Workers AI (GLM-5.2)
```

The real Cloudflare API token never leaves the Worker; clients only hold the
shared `PROXY_TOKEN`.

## Endpoints

| Method | Path                    | Forwards to                                   |
| ------ | ----------------------- | --------------------------------------------- |
| POST   | `/v1/chat/completions`  | `…/ai/v1/chat/completions`                    |
| POST   | `/v1/embeddings`        | `…/ai/v1/embeddings`                          |
| GET    | `/v1/models`            | `…/ai/v1/models`                              |
| GET    | `/` , `/health`         | status JSON                                   |

## Deploy

```sh
npm install

# secrets (not committed)
wrangler secret put CF_ACCOUNT_ID   # your Cloudflare account id
wrangler secret put CF_API_TOKEN    # API token with Workers AI access
wrangler secret put PROXY_TOKEN     # long random shared secret

wrangler deploy
```

For local dev, copy `.dev.vars.example` to `.dev.vars` and run `wrangler dev`.

## Test

```sh
curl https://glm-proxy.<your-subdomain>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"@cf/zai-org/glm-5.2","messages":[{"role":"user","content":"hi"}]}'
```

## Use from opencode

In `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "cf-glm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Cloudflare GLM-5.2",
      "options": {
        "baseURL": "https://glm-proxy.<your-subdomain>.workers.dev/v1",
        "apiKey": "{env:CF_GLM_PROXY_TOKEN}"
      },
      "models": {
        "@cf/zai-org/glm-5.2": {
          "name": "GLM-5.2 (Cloudflare)",
          "limit": { "context": 262144, "output": 65536 }
        }
      }
    }
  }
}
```

Export the proxy token so opencode can read it:

```sh
export CF_GLM_PROXY_TOKEN=<your PROXY_TOKEN>
```

Then pick `cf-glm / GLM-5.2 (Cloudflare)` via `/models` in opencode.
