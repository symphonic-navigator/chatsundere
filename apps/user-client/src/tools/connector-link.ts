// SPDX-License-Identifier: AGPL-3.0-only

/** Why a link cannot be proposed as a connector. */
export type ConnectorLinkRefusal =
  | 'invalid'
  | 'not-https'
  | 'userinfo'
  | 'fragment'
  | 'not-public'
  | 'too-long';

/** Outcome of normalising a connector link. */
export type ConnectorLinkResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: ConnectorLinkRefusal };

const MAX_LINK_LENGTH = 2048;
const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa'];
/** A scheme followed by a digit is a host and port (`example.com:8443`), not a scheme. */
export const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// Stripped from the end of a found link: sentence punctuation, closing brackets and quotes,
// and the Markdown and smart-punctuation wrappers phones and chat apps put around links.
const TRAILING_PUNCTUATION = new Set('.,;:!?)]}>\'"`*”’»…');
// `https?://…`, or a bare `host.tld/…` not preceded by a character that would make it
// part of something else (an e-mail address, a longer word or path).
const LINK_PATTERN =
  /\bhttps?:\/\/\S+|(?<![\p{L}\p{N}@./:_-])(?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]+(?::\d+)?(?:\/\S*)?/giu;

function isPublicHost(hostname: string): boolean {
  // `URL` has already lowercased the name and rewritten every IPv4 form as dotted decimal.
  const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (host.startsWith('[') || IPV4.test(host)) return false;
  if (host === 'localhost' || !host.includes('.')) return false;
  // An empty label (`a..b`, `localhost..`) is no public name.
  if (host.split('.').includes('')) return false;
  return !PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1));
}

/** Normalises a link and applies the connector link rules in order. */
export function normaliseConnectorLink(raw: string): ConnectorLinkResult {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (u.port === '0') return { ok: false, reason: 'invalid' };
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'userinfo' };
  // `hash` is empty for a bare `#`; a literal `#` in the href can only start a fragment.
  if (u.href.includes('#')) return { ok: false, reason: 'fragment' };
  if (!isPublicHost(u.hostname)) return { ok: false, reason: 'not-public' };
  if (u.href.length > MAX_LINK_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, url: u.href, host: u.hostname };
}

// A loop from the end, not a regex: a regex retried at every position is quadratic on a
// long run of punctuation, and user messages of an imported chat are hostile input.
function stripTrailing(link: string): string {
  let opens = 0;
  let closes = 0;
  for (const ch of link) {
    if (ch === '(') opens++;
    else if (ch === ')') closes++;
  }
  let end = link.length;
  while (end > 0) {
    const ch = link[end - 1] as string;
    if (!TRAILING_PUNCTUATION.has(ch)) break;
    // A `)` that closes a `(` inside the link belongs to it (`…/Foo_(bar)`).
    if (ch === ')' && closes <= opens) break;
    if (ch === ')') closes--;
    end--;
  }
  return link.slice(0, end);
}

/** Finds the links in a piece of user text. */
export function linksInText(text: string): string[] {
  const links: string[] = [];
  for (const match of text.matchAll(LINK_PATTERN)) {
    const link = stripTrailing(match[0]);
    if (link !== '') links.push(link);
  }
  return links;
}

// Only a link without a query: in a query a `/` is data, and adding one must not match.
function withoutTrailingSlash(url: string): string {
  return url.endsWith('/') && !url.includes('?') ? url.slice(0, -1) : url;
}

/** True when the user wrote the given normalised link in one of their messages. */
export function userWroteLink(url: string, userTexts: readonly string[]): boolean {
  const wanted = withoutTrailingSlash(url);
  return userTexts.some((text) =>
    linksInText(text).some((link) => {
      const found = normaliseConnectorLink(link);
      return found.ok && withoutTrailingSlash(found.url) === wanted;
    }),
  );
}

/**
 * True when the raw link, trimmed, is one the user wrote, compared as a plain string with
 * one trailing slash ignored. For a link that fails the rules, which cannot be normalised.
 */
export function userWroteRawLink(raw: string, userTexts: readonly string[]): boolean {
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  const wanted = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  return userTexts.some((text) =>
    linksInText(text).some((link) => (link.endsWith('/') ? link.slice(0, -1) : link) === wanted),
  );
}

/** Splits a host into its emphasised last two labels and everything before them. */
export function emphasisSplit(host: string): { lead: string; tail: string } {
  const dot = host.endsWith('.') ? '.' : '';
  const labels = (dot ? host.slice(0, -1) : host).split('.');
  if (labels.length <= 2) return { lead: '', tail: host };
  const tail = `${labels.slice(-2).join('.')}${dot}`;
  return { lead: host.slice(0, host.length - tail.length), tail };
}
