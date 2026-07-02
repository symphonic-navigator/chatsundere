// SPDX-License-Identifier: AGPL-3.0-only

/**
 * True if the resolved numeric IP is in any private, reserved, or internal
 * range (spec §5.1). Runs on the address returned by DNS resolution, so
 * alternate textual encodings normalise before they reach here.
 */
export function isBlockedIp(ip: string): boolean {
  const v4 = toIPv4(ip);
  if (v4 !== null) return isBlockedV4(v4);
  return isBlockedV6(ip);
}

/** Returns the dotted-quad IPv4 string if `ip` is IPv4 or an IPv4-embedding IPv6 form, else null. */
function toIPv4(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  return extractEmbeddedV4(ip.toLowerCase());
}

/** Extracts an embedded IPv4 from v4-mapped, v4-compat, NAT64 (64:ff9b::/96), or 6to4 (2002::/16). */
function extractEmbeddedV4(ip: string): string | null {
  // 6to4: 2002:AABB:CCDD::/48 embeds A.B.C.D in bits 16..48.
  if (ip.startsWith('2002:')) {
    const groups = expandV6(ip);
    if (!groups) return null;
    return v4FromGroups(groups[1], groups[2]);
  }
  // NAT64 64:ff9b::/96 and v4-mapped/v4-compat: last 32 bits are the IPv4.
  if (ip.startsWith('64:ff9b:') || ip.startsWith('::ffff:') || ip.startsWith('::')) {
    // dotted tail form, e.g. ::ffff:127.0.0.1
    const dotted = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (dotted) return dotted[1] ?? null;
    const groups = expandV6(ip);
    if (!groups) return null;
    return v4FromGroups(groups[6], groups[7]);
  }
  return null;
}

/** Builds a dotted-quad from the high and low 16-bit halves of a 32-bit IPv4. */
function v4FromGroups(hi: number | undefined, lo: number | undefined): string | null {
  if (hi === undefined || lo === undefined) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** Expands an IPv6 string to its 8 16-bit groups; returns null if unparseable. */
function expandV6(ip: string): number[] | null {
  const cleaned = ip.replace(/(\d{1,3}(?:\.\d{1,3}){3})$/, (m) => {
    const p = m.split('.').map(Number);
    const a = p[0] ?? 0;
    const b = p[1] ?? 0;
    const c = p[2] ?? 0;
    const d = p[3] ?? 0;
    return `${(((a << 8) | b) >>> 0).toString(16)}:${(((c << 8) | d) >>> 0).toString(16)}`;
  });
  const halves = cleaned.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g || '0', 16));
}

function isBlockedV4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return true; // malformed → block
  const [a, b, c, d] = parts as [number, number, number, number];
  const n = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
  const inRange = (base: string, bits: number): boolean => {
    const bp = base.split('.').map(Number);
    const [ba, bb, bc, bd] = bp as [number, number, number, number];
    const bn = ((ba << 24) >>> 0) + (bb << 16) + (bc << 8) + bd;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (bn & mask);
  };
  return (
    inRange('0.0.0.0', 8) || inRange('10.0.0.0', 8) || inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) || inRange('172.16.0.0', 12) || inRange('192.168.0.0', 16) ||
    inRange('100.64.0.0', 10) || inRange('192.0.0.0', 24) || inRange('198.18.0.0', 15) ||
    inRange('224.0.0.0', 4) || inRange('240.0.0.0', 4) || n === 0xffffffff
  );
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip.toLowerCase());
  if (!g) return true; // unparseable → block
  const first = g[0];
  if (first === undefined) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}
