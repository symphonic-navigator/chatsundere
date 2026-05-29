// SPDX-License-Identifier: LGPL-3.0-only
import { parseDocument } from 'yaml';
import type { BuiltOffering } from './model-file.js';

/**
 * Set the `built:` key on a model YAML, preserving all human comments and
 * formatting elsewhere. Re-running replaces the prior `built` value (idempotent)
 * rather than appending. Uses the `yaml` Document API so the human-curated half
 * above is untouched.
 */
export function writeBuiltBlock(source: string, built: BuiltOffering[]): string {
  const doc = parseDocument(source);
  doc.set('built', JSON.parse(JSON.stringify(built)));
  return doc.toString();
}
