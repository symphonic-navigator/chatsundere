// SPDX-License-Identifier: AGPL-3.0-only

import type { Context, Hono } from 'hono';
import { applyCorsHeaders, matchOrigin, preflightResponse } from '../cors.js';
import { normaliseLlmHost } from '../egress/known-hosts.js';
import {
  type Target,
  TargetError,
  parseTarget,
  pinnedFetch,
  resolveAndPin,
} from '../egress/target.js';
import type { Env } from '../env.js';
import {
  recordLlmRequest,
  recordRateLimited,
  recordRequest,
  recordSsrfBlocked,
  recordUnauthorized,
} from '../metrics.js';
import { deriveClientIp } from '../net/client-ip.js';
import { buildForwardHeaders, filterResponseHeaders } from '../proxy/headers.js';

/** Raised when the streamed request body exceeds MAX_BODY_BYTES. */
class BodyTooLargeError extends Error {}

/** Dependencies for the forward proxy route; `pinnedFetch` is injectable for tests. */
export interface ProxyDeps {
  env: Env;
  verifyToken: (token: string) => Promise<{ sub: string }>;
  allow: (key: string, limit: number, windowSec: number) => Promise<boolean>;
  pinnedFetch?: (forward: Request, target: Target) => Promise<Response>;
}

// Per-user concurrent-connection count. In-process → valid for a single replica
// (spec §6.4); a multi-replica deployment would move this to Redis.
const activeConnections = new Map<string, number>();

/** The real forward: resolve every A/AAAA record, block private ranges, connect to the pinned IP. */
async function defaultPinnedFetch(forward: Request, target: Target): Promise<Response> {
  const ip = await resolveAndPin(target.host);
  const reqUrl = new URL(forward.url);
  return pinnedFetch(ip, target, reqUrl, forward.method, forward.headers, forward.body);
}

/** Caps the streamed request body at `max` bytes, erroring the stream over the cap. */
function capBody(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > max) {
          controller.error(new BodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Wraps a response body so `release` runs exactly once on end, error, or client cancel. */
function releaseOnEnd(
  body: ReadableStream<Uint8Array>,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          release();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        release();
        controller.error(err);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
}

function errorResponse(
  c: Context,
  matched: string | null,
  status: 400 | 401 | 403 | 413 | 429 | 502,
  code: string,
): Response {
  if (matched) applyCorsHeaders(c, matched);
  if (status === 429) c.header('Retry-After', '60');
  return c.json({ error: { code, message: 'Request refused' } }, status);
}

/**
 * Registers the method-agnostic forward proxy on every path. Order per spec §3:
 * OPTIONS → per-IP limit (pre-auth) → verify token → per-user limit → parse
 * target → concurrency cap → forward (denylist headers, pinned IP) → stream back.
 */
export function registerProxyRoute(app: Hono, deps: ProxyDeps): void {
  const { env, verifyToken, allow } = deps;
  const doPinnedFetch = deps.pinnedFetch ?? defaultPinnedFetch;

  app.all('*', async (c) => {
    const origin = c.req.header('origin') ?? null;
    const matched = matchOrigin(origin, env.CORS_ALLOWED_ORIGINS);

    // 0. OPTIONS preflight.
    if (c.req.method === 'OPTIONS') {
      if (matched) return preflightResponse(c, matched);
      return c.body(null, 204);
    }

    // 1. Derive the trusted client IP.
    const directIp = (c.env as { ip?: string } | undefined)?.ip ?? '0.0.0.0';
    const clientIp = deriveClientIp(
      c.req.header('x-forwarded-for') ?? null,
      directIp,
      env.TRUST_PROXY_HOPS,
    );

    // 2. Per-IP rate limit (PRE-AUTH).
    if (!(await allow(`ip:${clientIp}`, env.RATE_LIMIT_IP_PER_MIN, 60))) {
      recordRateLimited();
      return errorResponse(c, matched, 429, 'rate_limited');
    }

    // 3. Verify the account token.
    const authz = c.req.header('x-chatsundere-authorization');
    const token = authz?.startsWith('Bearer ') ? authz.slice(7) : undefined;
    let sub: string;
    try {
      if (!token) throw new Error('missing account token');
      ({ sub } = await verifyToken(token));
    } catch {
      recordUnauthorized();
      return errorResponse(c, matched, 401, 'unauthorized');
    }

    // 4. Per-user rate limit.
    if (!(await allow(`user:${sub}`, env.RATE_LIMIT_USER_PER_MIN, 60))) {
      recordRateLimited();
      return errorResponse(c, matched, 429, 'rate_limited');
    }

    // 5. Parse + validate the target shape (no DNS here — that is in the forward).
    const rawTarget = c.req.header('x-cors-proxy-target');
    let target: Target;
    try {
      if (!rawTarget) throw new TargetError('Missing target header', 400);
      target = parseTarget(rawTarget);
    } catch (e) {
      const status = e instanceof TargetError ? e.status : 400;
      if (status === 403) recordSsrfBlocked();
      return errorResponse(c, matched, status, status === 403 ? 'blocked' : 'bad_target');
    }

    const kind: 'llm' | 'mcp' = c.req.header('x-cors-proxy-kind') === 'mcp' ? 'mcp' : 'llm';
    const llmOutcome = (o: 'ok' | 'upstream_error') =>
      kind === 'llm'
        ? recordLlmRequest({ host: normaliseLlmHost(target.host), outcome: o })
        : undefined;

    // Content-Length fast-path for the size ceiling (streamed enforcement below).
    const declaredLen = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(declaredLen) && declaredLen > env.MAX_BODY_BYTES) {
      return errorResponse(c, matched, 413, 'body_too_large');
    }

    // 6. Concurrency cap (in-process, per replica).
    const active = activeConnections.get(sub) ?? 0;
    if (active >= env.MAX_CONCURRENT_PER_USER) {
      recordRateLimited();
      return errorResponse(c, matched, 429, 'rate_limited');
    }
    activeConnections.set(sub, active + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const n = (activeConnections.get(sub) ?? 1) - 1;
      if (n <= 0) activeConnections.delete(sub);
      else activeConnections.set(sub, n);
    };

    try {
      const reqUrl = new URL(c.req.url);
      const forwardHeaders = buildForwardHeaders(c.req.raw.headers, target.host);
      const body = capBody(c.req.raw.body, env.MAX_BODY_BYTES);
      // Build against the target origin; the pinned IP is substituted in the forward.
      const forwardInit: RequestInit & { duplex?: 'half' } = {
        method: c.req.method,
        headers: forwardHeaders,
        body,
        redirect: 'manual',
        ...(body ? { duplex: 'half' } : {}),
      };
      const forward = new Request(
        `${target.origin}${reqUrl.pathname}${reqUrl.search}`,
        forwardInit,
      );

      const upstream = await doPinnedFetch(forward, target);

      const outcome: 'ok' | 'upstream_error' = upstream.status >= 500 ? 'upstream_error' : 'ok';
      recordRequest({ kind, outcome });
      llmOutcome(outcome);

      const respHeaders = filterResponseHeaders(upstream.headers);
      if (matched) {
        respHeaders.set('Access-Control-Allow-Origin', matched);
        respHeaders.set('Vary', 'Origin');
      }

      let outBody: ReadableStream<Uint8Array> | null = null;
      if (upstream.body) {
        outBody = releaseOnEnd(upstream.body, release);
      } else {
        release();
      }
      return new Response(outBody, { status: upstream.status, headers: respHeaders });
    } catch (e) {
      release();
      if (e instanceof TargetError && e.status === 403) {
        recordSsrfBlocked();
        recordRequest({ kind, outcome: 'blocked' });
        return errorResponse(c, matched, 403, 'blocked');
      }
      if (e instanceof BodyTooLargeError) {
        return errorResponse(c, matched, 413, 'body_too_large');
      }
      recordRequest({ kind, outcome: 'upstream_error' });
      // Generic 502 — never interpolate the error message or target (spec §8.1).
      return errorResponse(c, matched, 502, 'upstream_error');
    }
  });
}
