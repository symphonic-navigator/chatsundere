// SPDX-License-Identifier: AGPL-3.0-only
// Crockford-derived Base32 with V↔U swap — see spec § 2 Decision 8 and
// apps/auth-service/src/codes/token.ts for the canonical form.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTUWXYZ';
const ALPHABET_SET = new Set(ALPHABET);
const CODE_RE = /^[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}-[0-9ABCDEFGHJKMNPQRSTUWXYZ]{5}$/;

const SUBSTITUTIONS: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  V: 'Y',
};

export function normaliseCodeInput(raw: string): string {
  const upper = raw.toUpperCase();
  const chars: string[] = [];
  for (const ch of upper) {
    const mapped = SUBSTITUTIONS[ch] ?? ch;
    if (ALPHABET_SET.has(mapped)) chars.push(mapped);
    if (chars.length === 10) break;
  }
  if (chars.length <= 5) return chars.join('');
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

export function isValidCode(canonical: string): boolean {
  return CODE_RE.test(canonical);
}
