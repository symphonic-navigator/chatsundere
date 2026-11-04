// SPDX-License-Identifier: AGPL-3.0-only

/** The parts of a `Bearer` challenge the OAuth flow cares about. */
export type ParsedChallenge = { resourceMetadata?: string; scope?: string; error?: string };

const WS = /[ \t]/;
const TOKEN = /[!#$%&'*+\-.^_`|~0-9A-Za-z]+/y;
const TOKEN68 = /[A-Za-z0-9\-._~+/]+=*/y;

type Challenge = { scheme: string; params: Map<string, string> };

/** Splits a `WWW-Authenticate` value into challenges (RFC 9110 §11.6.1). */
function parseChallenges(header: string): Challenge[] {
  const out: Challenge[] = [];
  let current: Challenge | undefined;
  let i = 0;
  const n = header.length;

  const skipWs = (): void => {
    while (i < n && WS.test(header.charAt(i))) i++;
  };
  const skipSeparators = (): void => {
    while (i < n && (WS.test(header.charAt(i)) || header.charAt(i) === ',')) i++;
  };
  const readToken = (): string | null => {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(header);
    if (!m) return null;
    i = TOKEN.lastIndex;
    return m[0];
  };
  /** Reads a quoted-string; null when it is unterminated. */
  const readQuoted = (): string | null => {
    let value = '';
    i++; // opening quote
    while (i < n) {
      const c = header.charAt(i);
      if (c === '\\' && i + 1 < n) {
        value += header.charAt(i + 1);
        i += 2;
      } else if (c === '"') {
        i++;
        return value;
      } else {
        value += c;
        i++;
      }
    }
    return null;
  };
  /** Lenient unquoted value: everything up to the next comma or whitespace. */
  const readBareValue = (): string => {
    const from = i;
    while (i < n && header.charAt(i) !== ',' && !WS.test(header.charAt(i))) i++;
    return header.slice(from, i);
  };
  /** After a name and `=`: is this a real auth-param value, as opposed to token68 padding? */
  const valueFollows = (from: number): boolean => {
    let j = from;
    while (j < n && WS.test(header.charAt(j))) j++;
    if (j >= n) return false;
    const c = header.charAt(j);
    return c !== ',' && c !== '=';
  };

  while (i < n) {
    skipSeparators();
    if (i >= n) break;
    const start = i;
    const word = readToken();
    if (word === null) {
      // Stray punctuation: skip it so a malformed header cannot loop forever.
      i = start + 1;
      continue;
    }
    const afterWord = i;
    skipWs();
    if (current && header.charAt(i) === '=') {
      i++;
      skipWs();
      const value = header.charAt(i) === '"' ? readQuoted() : readBareValue();
      const key = word.toLowerCase();
      if (value !== null && !current.params.has(key)) current.params.set(key, value);
      continue;
    }
    // Anything else is the scheme of a new challenge.
    i = afterWord;
    current = { scheme: word.toLowerCase(), params: new Map() };
    out.push(current);
    skipWs();
    // token68 form: consume it so its padding is not mistaken for a parameter.
    const probe = i;
    const nameThenEq = ((): boolean => {
      TOKEN.lastIndex = probe;
      const m = TOKEN.exec(header);
      if (!m) return false;
      let j = TOKEN.lastIndex;
      while (j < n && WS.test(header.charAt(j))) j++;
      return header.charAt(j) === '=' && valueFollows(j + 1);
    })();
    // Bearer (RFC 6750) never uses token68, so `Bearer error=` is an empty parameter.
    if (current.scheme !== 'bearer' && !nameThenEq && i < n && header.charAt(i) !== ',') {
      TOKEN68.lastIndex = i;
      if (TOKEN68.exec(header)) i = TOKEN68.lastIndex;
    }
  }
  return out;
}

/**
 * Extracts `resource_metadata`, `scope` and `error` from the first `Bearer`
 * challenge of a `WWW-Authenticate` header; null when there is none.
 */
export function parseBearerChallenge(header: string): ParsedChallenge | null {
  const bearer = parseChallenges(header).find((c) => c.scheme === 'bearer');
  if (!bearer) return null;
  const result: ParsedChallenge = {};
  const resourceMetadata = bearer.params.get('resource_metadata');
  const scope = bearer.params.get('scope');
  const error = bearer.params.get('error');
  if (resourceMetadata !== undefined) result.resourceMetadata = resourceMetadata;
  if (scope !== undefined) result.scope = scope;
  if (error !== undefined) result.error = error;
  return result;
}
