// SPDX-License-Identifier: AGPL-3.0-only

/** What the provider page shows for a failed key test: the cause and next step, plus the raw detail. */
export interface KeyTestFailure {
  /** The cause and what to do about it, in plain words. */
  message: string;
  /** The raw probe result (`<status> · <reason>`), shown smaller underneath. */
  detail: string;
}

/**
 * Map a failed `probeProvider` result to a cause and a next step (spec 0.5.0
 * papercuts, item 6). Status 0 is a fetch that never got an answer — offline,
 * blocked, or a provider refusing browser (CORS) requests — so the routing
 * decides which of those is plausible. Errors thrown before the probe (a key
 * that can't be opened, no master key) are mapped by the page's own `catch`.
 */
export function keyTestFailure(input: {
  providerName: string;
  /** True when the probe went through the linked server's relay. */
  viaRelay: boolean;
  status: number;
  reason?: string;
}): KeyTestFailure {
  const { providerName: name, status } = input;
  const detail = input.reason ? `${status} · ${input.reason}` : String(status);
  return { message: messageFor(name, status, input.viaRelay), detail };
}

function messageFor(name: string, status: number, viaRelay: boolean): string {
  if (status === 0) {
    return viaRelay
      ? `Couldn't reach ${name} through your server's relay. Check your connection, or try again in a moment.`
      : `Couldn't reach ${name}. Check your connection. If it works, ${name} may not accept requests from a browser.`;
  }
  if (status === 401 || status === 403) {
    return `${name} didn't accept this key. Check that it was copied in full and is still active.`;
  }
  if (status === 429) return `${name} is busy or rate-limiting this key. Try again in a minute.`;
  return `${name} answered with an error (${status}).`;
}
