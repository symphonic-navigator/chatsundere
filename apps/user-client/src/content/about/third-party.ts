// SPDX-License-Identifier: AGPL-3.0-only
import { THIRD_PARTY_LICENCES } from '../../lib/third-party-licences.js';

/** Render the bundled third-party licence list as Markdown (single source of
 *  truth — the structured array in third-party-licences.ts). */
export function renderThirdPartyMarkdown(): string {
  const intro =
    'Chatsundere is built on the following open-source libraries. Thank you to everyone who made them.';
  const rows = THIRD_PARTY_LICENCES.map(
    (e) => `- **${e.name}** \`v${e.version}\` — ${e.licence} — [${e.homepage}](${e.homepage})`,
  ).join('\n');
  return `# Third-party libraries\n\n${intro}\n\n${rows}\n`;
}
