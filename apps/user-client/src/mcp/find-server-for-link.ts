// SPDX-License-Identifier: AGPL-3.0-only
import type { McpServerRow } from '../boot/client-data-db.js';
import { linkVariants } from './mcp-connectivity.js';
import { canonicalResource } from './oauth/url.js';

function tryCanonical(url: string): string | undefined {
  try {
    return canonicalResource(url);
  } catch {
    return undefined;
  }
}

// The same variants the check probes, so a row it saved is always found.
function linkForms(link: string): Set<string> {
  const forms = new Set<string>();
  for (const variant of linkVariants(link.trim())) {
    const canonical = tryCanonical(variant);
    if (canonical !== undefined) forms.add(canonical);
  }
  return forms;
}

/**
 * The first row that already serves `link` or its `/mcp` variant (spec §4.3);
 * rows whose URL does not canonicalise are skipped, and an invalid link matches nothing.
 */
export function findServerForLink(
  rows: readonly McpServerRow[],
  link: string,
): McpServerRow | undefined {
  const forms = linkForms(link);
  if (forms.size === 0) return undefined;
  return rows.find((row) => {
    const canonical = tryCanonical(row.url);
    return canonical !== undefined && forms.has(canonical);
  });
}
