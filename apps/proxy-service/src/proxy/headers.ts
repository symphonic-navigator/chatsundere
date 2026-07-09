// SPDX-License-Identifier: AGPL-3.0-only

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'transfer-encoding',
  'proxy-authorization',
  'proxy-connection',
]);

/** True for headers that must never be forwarded upstream (proxy-only + hop-by-hop). */
function isStrippedRequestHeader(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.startsWith('x-chatsundere-') ||
    k.startsWith('x-cors-proxy-') ||
    HOP_BY_HOP.has(k) ||
    k === 'host'
  );
}

/** Copies every request header except the tested strip-denylist; rewrites Host to the target. */
export function buildForwardHeaders(incoming: Headers, targetHost: string): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    if (!isStrippedRequestHeader(key)) out.set(key, value);
  });
  out.set('host', targetHost);
  // Force an identity content-coding upstream so the response body is never
  // compressed. Bun's fetch would transparently decode a compressed body while
  // leaving `Content-Encoding` on the response headers, and re-streaming that
  // decoded body under a stale coding header is exactly ERR_CONTENT_DECODING_FAILED
  // (see filterResponseHeaders). Pinning identity removes the ambiguity at source;
  // the response-side strip stays as a safety net. The cost is negligible — SSE is
  // already uncompressed and the affected JSON replies (title-gen, memory) are tiny.
  out.set('accept-encoding', 'identity');
  return out;
}

/**
 * Copies every response header except Set-Cookie, upstream CORS, hop-by-hop, and
 * the content-coding descriptors. Bun's fetch transparently decodes the upstream
 * body (gzip/br/deflate) before we re-stream it, so `Content-Encoding` and
 * `Content-Length` describe the *encoded* bytes we no longer emit — forwarding
 * them makes the browser try to gunzip a plaintext body and fail with
 * ERR_CONTENT_DECODING_FAILED. Streaming SSE responses carry neither header, so
 * only non-streaming JSON replies (title generation, memory extraction) hit this.
 */
export function filterResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie' || k === 'set-cookie2') return;
    if (k.startsWith('access-control-')) return;
    if (k === 'content-encoding' || k === 'content-length') return;
    if (HOP_BY_HOP.has(k)) return;
    out.set(key, value);
  });
  return out;
}
