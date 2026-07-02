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
  return out;
}

/** Copies every response header except Set-Cookie, upstream CORS, and hop-by-hop. */
export function filterResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie' || k === 'set-cookie2') return;
    if (k.startsWith('access-control-')) return;
    if (HOP_BY_HOP.has(k)) return;
    out.set(key, value);
  });
  return out;
}
