// SPDX-License-Identifier: AGPL-3.0-only

import { lookup } from 'node:dns/promises';
import { isBlockedIp } from './blocked-ranges.js';

/** A parsed, shape-validated forward target. */
export interface Target {
  origin: string;
  /** Authority for the forwarded Host header — hostname plus any non-default port. */
  host: string;
  /** Hostname only (no port) — used for DNS resolution and TLS SNI. */
  hostname: string;
  /** Explicit port, or '' when the scheme default (443/80) applies. */
  port: string;
  protocol: 'https:' | 'http:';
}

/** A rejected target; `status` maps directly to the HTTP response code. */
export class TargetError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
    this.name = 'TargetError';
  }
}

/** Validates the `x-cors-proxy-target` shape (spec §5.6): absolute https/http origin, no userinfo, no path/query. */
export function parseTarget(raw: string): Target {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TargetError('Malformed target URL', 400);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TargetError('Target scheme must be https or http', 400);
  }
  if (url.username || url.password) throw new TargetError('Target must not contain userinfo', 400);
  if ((url.pathname && url.pathname !== '/') || url.search) {
    throw new TargetError('Target must be an origin, without path or query', 400);
  }
  // `url.host` carries the port only when it is non-default for the scheme, so
  // the Host header stays clean (`example.com`) for default ports and explicit
  // (`example.com:8443`) otherwise. `hostname`/`port` are split out for DNS+SNI
  // and the pinned-connection URL respectively.
  return {
    origin: url.origin,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    protocol: url.protocol,
  };
}

/**
 * Resolves every A/AAAA record for `host`, blocks if ANY is a private/internal
 * range, and returns one allowed IP to pin the connection to (DNS-rebinding
 * defence — the checked IP is the connected IP).
 */
export async function resolveAndPin(host: string): Promise<string> {
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new TargetError('Target host does not resolve', 403);
  }
  if (records.length === 0) throw new TargetError('Target host does not resolve', 403);
  for (const r of records) {
    if (isBlockedIp(r.address)) throw new TargetError('Target resolves to a blocked range', 403);
  }
  const first = records[0];
  if (!first) throw new TargetError('Target host does not resolve', 403);
  return first.address;
}

/**
 * Connects to the pre-checked IP directly (no second DNS lookup → no TOCTOU),
 * validating SNI + cert against the real host. `redirect: 'manual'` so a 3xx to a
 * private range is never followed — it is returned to the client to re-issue and
 * re-check from scratch (spec §5.2/§5.3).
 */
export function pinnedFetch(
  ip: string,
  target: Target,
  requestUrl: URL,
  method: string,
  headers: Headers,
  body: RequestInit['body'],
): Promise<Response> {
  const hostForUrl = ip.includes(':') ? `[${ip}]` : ip;
  // Pin to the checked IP but preserve the target's explicit port, so a target
  // like `https://example.com:8443` connects on 8443 rather than silently on the
  // scheme default. `target.port` is '' for default ports, adding no suffix.
  const portSuffix = target.port ? `:${target.port}` : '';
  const connectUrl = `${target.protocol}//${hostForUrl}${portSuffix}${requestUrl.pathname}${requestUrl.search}`;
  // Bun's fetch accepts `tls.serverName`; typed loosely here since the standard
  // RequestInit lacks it. SNI carries the bare hostname (never a port) and is
  // only meaningful for the TLS (https) path.
  const init: RequestInit & { tls?: { serverName: string } } = {
    method,
    headers,
    body,
    redirect: 'manual',
    ...(method === 'GET' || method === 'HEAD' ? {} : { duplex: 'half' as const }),
    ...(target.protocol === 'https:' ? { tls: { serverName: target.hostname } } : {}),
  };
  return fetch(connectUrl, init as RequestInit);
}
