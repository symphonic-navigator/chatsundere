// SPDX-License-Identifier: AGPL-3.0-only

export interface ThirdPartyEntry {
  /** Human-readable name. */
  name: string;
  /** Major.minor version we depend on (no SHA / no transitive depth). */
  version: string;
  /** SPDX short licence identifier. */
  licence: string;
  /** Canonical homepage or repository URL. */
  homepage: string;
}

/**
 * Curated list of the user-client's direct runtime dependencies plus
 * bundled assets (fonts). Workspace-internal packages
 * (@chatsundere/crypto, @chatsundere/llm-unified, @chatsundere/shared-types,
 * @chatsundere/ui-shared) are not third-party and are deliberately omitted.
 *
 * Maintenance: update versions on every `pnpm update` that bumps a
 * major / minor of a listed dependency. The list is intentionally
 * curated rather than auto-generated.
 */
export const THIRD_PARTY_LICENCES: readonly ThirdPartyEntry[] = [
  { name: 'React', version: '18.3', licence: 'MIT', homepage: 'https://react.dev' },
  {
    name: 'react-router-dom',
    version: '6.28',
    licence: 'MIT',
    homepage: 'https://reactrouter.com',
  },
  {
    name: 'TanStack Query',
    version: '5.59',
    licence: 'MIT',
    homepage: 'https://tanstack.com/query',
  },
  { name: 'Zustand', version: '5.0', licence: 'MIT', homepage: 'https://zustand.docs.pmnd.rs' },
  { name: 'Dexie', version: '4.x', licence: 'Apache-2.0', homepage: 'https://dexie.org' },
  { name: 'Valibot', version: '0.42', licence: 'MIT', homepage: 'https://valibot.dev' },
  { name: 'Tailwind CSS', version: '4.x', licence: 'MIT', homepage: 'https://tailwindcss.com' },
  {
    name: 'qr-scanner',
    version: '1.4',
    licence: 'MIT',
    homepage: 'https://github.com/nimiq/qr-scanner',
  },
  {
    name: 'workbox-window',
    version: '7.3',
    licence: 'MIT',
    homepage: 'https://developer.chrome.com/docs/workbox',
  },
  {
    name: 'uuidv7',
    version: '1.0',
    licence: 'Apache-2.0',
    homepage: 'https://github.com/LiosK/uuidv7-js',
  },
  { name: 'Inter', version: 'variable', licence: 'OFL-1.1', homepage: 'https://rsms.me/inter' },
  {
    name: 'Lora',
    version: 'static',
    licence: 'OFL-1.1',
    homepage: 'https://fonts.google.com/specimen/Lora',
  },
];
