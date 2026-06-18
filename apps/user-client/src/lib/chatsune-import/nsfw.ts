// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The NSFW import rule: `adultPersona` can only gain capability, never lose it.
 * Applied independently of the config-overwrite choice (spec §5.3).
 */
export function resolveImportedNsfw(existing: boolean, imported: boolean): boolean {
  return existing || imported;
}
