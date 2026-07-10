// SPDX-License-Identifier: AGPL-3.0-only

import { ApiError } from '../middleware/error-envelope.js';
import { createRedis } from '../redis/client.js';

const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 10;

// Per-IP backstop against username-spraying (Finding #8). One IP may host
// several legitimate users (NAT, office wifi, mobile carrier), so the ceiling
// is well above the per-username one — high enough not to punish shared
// networks, low enough to still cap an enumeration burst from a single
// address at roughly 1 attempt every 22 s instead of being unthrottled.
const LOGIN_IP_WINDOW_SEC = 15 * 60;
const LOGIN_IP_MAX_ATTEMPTS = 40;

// Trims the window, records this attempt, and atomically decides whether it
// breaches `max` — all in one EVAL so N concurrent callers can never all
// observe a sub-threshold count before any of them lands their ZADD (the bug
// in the previous zremrangebyscore -> zcard -> check -> zadd sequence: every
// step was a separate round-trip, so concurrent requests raced the same
// stale read). Returns true when this attempt pushed the window over `max`;
// on that path the just-added member is removed again so a blocked attempt
// does not itself count towards the next window.
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local max = tonumber(ARGV[4])
local member = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
redis.call('ZADD', key, now, member)
local count = redis.call('ZCARD', key)
redis.call('PEXPIRE', key, windowMs)
if count > max then
  redis.call('ZREM', key, member)
  return 1
else
  return 0
end
`;

async function checkSlidingWindow(
  redisKey: string,
  windowSec: number,
  max: number,
): Promise<boolean> {
  const redis = createRedis();
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = now - windowMs;
  const member = `${now}:${crypto.randomUUID()}`;
  const result = await redis.eval(
    SLIDING_WINDOW_SCRIPT,
    1,
    redisKey,
    now,
    windowStart,
    windowMs,
    max,
    member,
  );
  return result === 1;
}

/**
 * Applies a per-username sliding-window rate limit, atomically, plus an
 * optional per-IP backstop.
 *
 * Normalises the username to lowercase before building the Redis key so that
 * `Alice` and `alice` share the same counter (the DB uses citext for usernames).
 *
 * Used by both /api/v1/opaque/login/start, /api/v1/passkey/login/start, and
 * /api/v1/recovery/start to maintain consistent 10 attempts / 15 min throttling
 * per spec §8.4. When a real `ip` is supplied, a second bucket keyed on that
 * address throttles username-spraying from a single source. The address is the
 * spoof-resistant one derived by ipKey() (TRUST_PROXY_HOPS), so the bucket runs
 * unconditionally — an attacker can no longer forge X-Forwarded-For to spoof a
 * victim's IP and burn through the ceiling to lock them out (Finding M2, harm 2,
 * now closed by hop-counted derivation rather than a default-off flag). The
 * 'unknown' sentinel is the sole exclusion (see below).
 */
export async function applyLoginRateLimit(username: string, ip?: string): Promise<void> {
  // Normalise to lowercase so casing variants do not bypass the limit.
  const usernameRedisKey = `rl:login:username:${username.toLowerCase()}`;
  const usernameLimited = await checkSlidingWindow(
    usernameRedisKey,
    LOGIN_WINDOW_SEC,
    LOGIN_MAX_ATTEMPTS,
  );
  if (usernameLimited) {
    throw new ApiError(429, 'rate_limited', 'Too many login attempts for this username');
  }

  // 'unknown' is ipKey()'s sentinel for "no derivable client address" — it is
  // never a real address, so it must never drive the IP bucket. Without this
  // guard, any deployment where the socket peer is unavailable funnels every
  // login/passkey/recovery attempt from every user into the single
  // rl:login:ip:unknown bucket, capping ALL users at LOGIN_IP_MAX_ATTEMPTS
  // globally — a self-inflicted DoS (Finding M2, harm 1). The derived IP is
  // otherwise spoof-resistant (TRUST_PROXY_HOPS), so the backstop runs
  // unconditionally for a real address.
  if (ip && ip !== 'unknown') {
    const ipRedisKey = `rl:login:ip:${ip}`;
    const ipLimited = await checkSlidingWindow(
      ipRedisKey,
      LOGIN_IP_WINDOW_SEC,
      LOGIN_IP_MAX_ATTEMPTS,
    );
    if (ipLimited) {
      throw new ApiError(429, 'rate_limited', 'Too many login attempts from this address');
    }
  }
}
