// SPDX-License-Identifier: LGPL-3.0-only

export type Intent =
  | { kind: 'help' }
  | { kind: 'provider-list' }
  | { kind: 'model-list'; provider: string | null }
  | { kind: 'model-template'; refs: string[] }
  | { kind: 'model-build'; file: string; verify: boolean }
  | { kind: 'model-report'; ref: string }
  | { kind: 'model-verify'; ref: string | null; all: boolean };

/** Pure argv → intent. The live entry maps intents to I/O. */
export function parseArgs(argv: string[]): Intent {
  const [group, sub, ...rest] = argv;
  if (!group || group === '--help' || group === 'help') return { kind: 'help' };

  if (group === 'provider' && sub === 'list') return { kind: 'provider-list' };

  if (group === 'model') {
    const positional = rest.filter((a) => !a.startsWith('--'));
    const flags = new Set(rest.filter((a) => a.startsWith('--')));
    if (sub === 'list') return { kind: 'model-list', provider: positional[0] ?? null };
    if (sub === 'template' && positional.length > 0)
      return { kind: 'model-template', refs: positional };
    if (sub === 'build' && positional[0])
      return { kind: 'model-build', file: positional[0], verify: flags.has('--verify') };
    if (sub === 'report' && positional[0]) return { kind: 'model-report', ref: positional[0] };
    if (sub === 'verify')
      return { kind: 'model-verify', ref: positional[0] ?? null, all: flags.has('--all') };
  }

  return { kind: 'help' };
}

export const HELP_TEXT = `curate — Chatsundere model-support factory

  curate provider list
  curate model list [provider]
  curate model template <provider:slug>...   > model.yaml
  curate model build <file.yaml> [--verify]
  curate model report <ref>
  curate model verify <ref> | --all
`;
