// SPDX-License-Identifier: AGPL-3.0-only

/** The send cannot fit even after normal truncation → compact synchronously
 *  first. Conservative: treats reaching the window as overflow. */
export function wouldOverflow(usedTokens: number, window: number): boolean {
  return usedTokens >= window;
}
