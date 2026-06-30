/**
 * GLM-5.2 proxy Worker.
 *
 * A thin reverse proxy that exposes an OpenAI-compatible API surface and
 * forwards to Cloudflare Workers AI's native OpenAI-compatible endpoint:
 *
 *   POST /v1/chat/completions  ->  /accounts/{id}/ai/v1/chat/completions
 *   POST /v1/embeddings        ->  /accounts/{id}/ai/v1/embeddings
 *   GET  /v1/models            ->  /accounts/{id}/ai/v1/models
 *
 * Why a passthrough instead of the AI binding: the binding returns Workers AI's
 * native shape, which we'd have to re-map to OpenAI format (including tool_calls
 * and SSE deltas). Forwarding to the OpenAI-compatible endpoint lets Cloudflare
 * do that conversion, so an agentic client like opencode gets correct
 * function-calling and streaming with zero translation on our side.
 *
 * Auth: callers must send `Authorization: Bearer <PROXY_TOKEN>`. We swap that
 * for the real Cloudflare API token before forwarding, so the CF token never
 * leaves the Worker.
 *
 * Secrets (set with `wrangler secret put`):
 *   CF_ACCOUNT_ID  - Cloudflare account id
 *   CF_API_TOKEN   - Cloudflare API token with Workers AI access
 *   PROXY_TOKEN    - shared secret that clients (opencode) must present
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/** Constant-time-ish string compare to avoid trivial timing leaks. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized() {
  return new Response(
    JSON.stringify({ error: { message: "Unauthorized", type: "invalid_request_error" } }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Friendly root + health so hitting the URL in a browser isn't a scary 401.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "glm-5.2 openai-compatible proxy",
          usage: "POST /v1/chat/completions with model \"@cf/zai-org/glm-5.2\"",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    // Only the OpenAI-compatible surface is proxied.
    if (!url.pathname.startsWith("/v1/")) {
      return new Response("Not found", { status: 404 });
    }

    // Verify the caller's bearer token.
    const auth = request.headers.get("authorization") || "";
    const presented = auth.replace(/^Bearer\s+/i, "");
    if (!env.PROXY_TOKEN || !safeEqual(presented, env.PROXY_TOKEN)) {
      return unauthorized();
    }

    if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
      return new Response(
        JSON.stringify({ error: { message: "Proxy is missing CF_ACCOUNT_ID / CF_API_TOKEN secrets" } }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // /v1/chat/completions -> /accounts/{id}/ai/v1/chat/completions
    const target = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/ai${url.pathname}${url.search}`;

    // Build a clean header set; never forward the client's (proxy) token.
    const fwd = new Headers();
    fwd.set("authorization", `Bearer ${env.CF_API_TOKEN}`);
    const ct = request.headers.get("content-type");
    if (ct) fwd.set("content-type", ct);
    const accept = request.headers.get("accept");
    if (accept) fwd.set("accept", accept);

    const init = { method: request.method, headers: fwd };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    const upstream = await fetch(target, init);

    // Stream the upstream response straight back (preserves SSE for streaming).
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    });
  },
};
