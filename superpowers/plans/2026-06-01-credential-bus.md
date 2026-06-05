# Credential Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client-side credential bus that answers "does the user have an API key for credential X?" and, MasterKey-gated, returns it — sourced by passing through existing enabled LLM-provider keys, with a reactive presence hook for future integrations.

**Architecture:** A thin facade (`createCredentialBus`) over an ordered array of `CredentialSource`s. One source today — `providerKeySource` — reads enabled `ProviderRow`s from Dexie (`credentialId === templateId`) and opens the sealed `apiKey` via `openSecret`. Presence is MasterKey-free (row existence); retrieval is MasterKey-gated. A `useCredential` TanStack hook keyed under the `providers` query prefix gives automatic reactivity on key add/delete. No new persistence, no Dexie migration.

**Tech Stack:** TypeScript (strict), Dexie (`getClientDataDb`), `@chatsundere/crypto` (`MasterKey`, `openSecret`/`sealSecret` via `src/lib/secrets.ts`), TanStack Query, Vitest + `fake-indexeddb`, `@testing-library/react`.

---

## File structure

| File | Responsibility |
|---|---|
| `apps/user-client/src/credentials/types.ts` | `CredentialId`, `CredentialSource`, `CredentialPresence` |
| `apps/user-client/src/credentials/sources/provider-key-source.ts` | The one source today: enabled `ProviderRow` lookup + `openSecret` |
| `apps/user-client/src/credentials/credential-bus.ts` | `createCredentialBus` facade + default-bound `hasCredential`/`getCredentialKey` |
| `apps/user-client/src/credentials/use-credential.ts` | Reactive `useCredential(id)` hook |
| `apps/user-client/tests/unit/credential-provider-source.test.ts` | Source unit tests |
| `apps/user-client/tests/unit/credential-bus.test.ts` | Bus dispatch tests |
| `apps/user-client/tests/unit/use-credential.test.tsx` | Reactive hook tests |
| `obsidian/decisions/0033-credential-bus.md` | ADR |
| `obsidian/ARCHITECTURE.md` | New "Credential bus" section |
| `obsidian/insights/security-deferrals.md` | Security-journal note (new access surface) |

**Conventions to follow (verified in-repo):**
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- Imports use explicit `.js` extensions (ESM/NodeNext): `'../boot/client-data-db.js'`.
- Tests live in `apps/user-client/tests/unit/`, import `'fake-indexeddb/auto'` first.
- Build verification is `pnpm typecheck` (the CI gate) — run from repo root.
- All repo text is British English. No emojis in code/commits.

---

### Task 1: Types + provider-key source

**Files:**
- Create: `apps/user-client/src/credentials/types.ts`
- Create: `apps/user-client/src/credentials/sources/provider-key-source.ts`
- Test: `apps/user-client/tests/unit/credential-provider-source.test.ts`

- [ ] **Step 1: Write `types.ts`** (no test — type-only, no runtime behaviour)

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';

/**
 * Abstract credential identity. For provider-backed credentials this equals
 * the provider's `templateId` (e.g. 'nano-gpt'). The bus encapsulates which
 * source ultimately serves the id.
 */
export type CredentialId = string;

/**
 * A source of credentials the bus can query. The provider-key source is the
 * only implementation today; a standalone-key source (e.g. a LAN actuator key
 * with no LLM provider behind it) is the documented future extension and is
 * appended to the bus's source list without changing the bus or consumers.
 */
export interface CredentialSource {
  /** Stable discriminator, e.g. 'provider-key'. */
  readonly kind: string;
  /** Presence check — MasterKey-free. `true` iff this source serves `id`. */
  has(id: CredentialId): Promise<boolean>;
  /**
   * Retrieve the plaintext key — MasterKey-gated. Returns `null` if this
   * source does not serve `id`. Throws if the MasterKey is wrong/absent
   * (the AES-GCM auth tag fails).
   */
  get(id: CredentialId, mk: MasterKey): Promise<string | null>;
}

/** Reactive presence snapshot returned by the `useCredential` hook. */
export interface CredentialPresence {
  present: boolean;
  isLoading: boolean;
}
```

- [ ] **Step 2: Write the failing test** `credential-provider-source.test.ts`

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
  type ProviderRow,
} from '../../src/boot/client-data-db.js';
import { sealSecret } from '../../src/lib/secrets.js';
import { providerKeySource } from '../../src/credentials/sources/provider-key-source.js';

let mk: MasterKey;
let otherMk: MasterKey;

beforeAll(() => {
  mk = asMasterKey(getRandomBytes(32));
  otherMk = asMasterKey(getRandomBytes(32));
});

async function addProvider(args: {
  id: string;
  templateId: string;
  enabled: boolean;
  key: string;
}): Promise<void> {
  const apiKey = await sealSecret(args.key, mk, `provider/${args.id}/api-key`);
  const now = Date.now();
  const row: ProviderRow = {
    id: args.id,
    templateId: args.templateId,
    displayName: args.templateId,
    baseUrl: '',
    apiKey,
    routing: { kind: 'direct' },
    enabled: args.enabled,
    createdAt: now,
    updatedAt: now,
  };
  await getClientDataDb().providers.add(row);
}

describe('providerKeySource', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('has() is true for an enabled provider row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: true, key: 'k' });
    expect(await providerKeySource.has('nano-gpt')).toBe(true);
  });

  it('has() is false for a disabled provider row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: false, key: 'k' });
    expect(await providerKeySource.has('nano-gpt')).toBe(false);
  });

  it('has() is false when no row matches the id', async () => {
    expect(await providerKeySource.has('nano-gpt')).toBe(false);
  });

  it('get() opens the sealed key for an enabled row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: true, key: 'secret-key' });
    expect(await providerKeySource.get('nano-gpt', mk)).toBe('secret-key');
  });

  it('get() returns null for a disabled row', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: false, key: 'secret-key' });
    expect(await providerKeySource.get('nano-gpt', mk)).toBeNull();
  });

  it('get() returns null when no row matches the id', async () => {
    expect(await providerKeySource.get('nano-gpt', mk)).toBeNull();
  });

  it('get() throws with the wrong MasterKey (AES-GCM tag)', async () => {
    await addProvider({ id: 'row-a', templateId: 'nano-gpt', enabled: true, key: 'secret-key' });
    await expect(providerKeySource.get('nano-gpt', otherMk)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/unit/credential-provider-source.test.ts`
Expected: FAIL — `Cannot find module '../../src/credentials/sources/provider-key-source.js'`

- [ ] **Step 4: Write `provider-key-source.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { getClientDataDb, type ProviderRow } from '../../boot/client-data-db.js';
import { openSecret } from '../../lib/secrets.js';
import type { CredentialId, CredentialSource } from '../types.js';

/**
 * Find the first enabled provider row whose `templateId` equals the credential
 * id. `templateId` is indexed; `enabled` is filtered in memory. Returns
 * `undefined` when none match. First-match is deterministic over Dexie order;
 * duplicate enabled rows for one `templateId` should not occur.
 */
async function findEnabledRow(id: CredentialId): Promise<ProviderRow | undefined> {
  return await getClientDataDb()
    .providers.where('templateId')
    .equals(id)
    .filter((row) => row.enabled)
    .first();
}

/**
 * The provider-backed credential source: passes through the API keys the user
 * already entered as LLM providers. Presence requires an enabled row (per the
 * spec's `enabled`-gating decision); retrieval opens the sealed `apiKey` using
 * the same slot the chat path uses (`provider/<rowId>/api-key`).
 */
export const providerKeySource: CredentialSource = {
  kind: 'provider-key',

  async has(id: CredentialId): Promise<boolean> {
    return (await findEnabledRow(id)) !== undefined;
  },

  async get(id: CredentialId, mk: MasterKey): Promise<string | null> {
    const row = await findEnabledRow(id);
    if (!row) return null;
    return await openSecret(row.apiKey, mk, `provider/${row.id}/api-key`);
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run tests/unit/credential-provider-source.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no new errors)

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/credentials/types.ts \
        apps/user-client/src/credentials/sources/provider-key-source.ts \
        apps/user-client/tests/unit/credential-provider-source.test.ts
git commit -m "Add credential-bus types and provider-key source"
```

---

### Task 2: Credential bus facade

**Files:**
- Create: `apps/user-client/src/credentials/credential-bus.ts`
- Test: `apps/user-client/tests/unit/credential-bus.test.ts`

- [ ] **Step 1: Write the failing test** `credential-bus.test.ts`

The bus dispatches across an ordered source array (first-match). The test uses
two fake in-memory sources via the `createCredentialBus` factory — no Dexie
needed here (the source↔Dexie wiring is covered by Task 1).

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { type MasterKey, asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import { createCredentialBus } from '../../src/credentials/credential-bus.js';
import type { CredentialSource } from '../../src/credentials/types.js';

const mk: MasterKey = asMasterKey(getRandomBytes(32));

/** A fake source that serves exactly one id with one key. */
function fakeSource(kind: string, servedId: string, key: string): CredentialSource {
  return {
    kind,
    has: async (id) => id === servedId,
    get: async (id) => (id === servedId ? key : null),
  };
}

describe('createCredentialBus', () => {
  it('hasCredential is true when any source serves the id', async () => {
    const bus = createCredentialBus([fakeSource('a', 'nano-gpt', 'k')]);
    expect(await bus.hasCredential('nano-gpt')).toBe(true);
  });

  it('hasCredential is false for an unknown id', async () => {
    const bus = createCredentialBus([fakeSource('a', 'nano-gpt', 'k')]);
    expect(await bus.hasCredential('unknown')).toBe(false);
  });

  it('getCredentialKey returns the first non-null source result', async () => {
    const bus = createCredentialBus([
      fakeSource('a', 'other', 'wrong'),
      fakeSource('b', 'nano-gpt', 'right'),
    ]);
    expect(await bus.getCredentialKey('nano-gpt', mk)).toBe('right');
  });

  it('getCredentialKey returns null for an unknown id', async () => {
    const bus = createCredentialBus([fakeSource('a', 'nano-gpt', 'k')]);
    expect(await bus.getCredentialKey('unknown', mk)).toBeNull();
  });

  it('first-match: an earlier source wins over a later one', async () => {
    const bus = createCredentialBus([
      fakeSource('a', 'nano-gpt', 'first'),
      fakeSource('b', 'nano-gpt', 'second'),
    ]);
    expect(await bus.getCredentialKey('nano-gpt', mk)).toBe('first');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/unit/credential-bus.test.ts`
Expected: FAIL — `Cannot find module '../../src/credentials/credential-bus.js'`

- [ ] **Step 3: Write `credential-bus.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { providerKeySource } from './sources/provider-key-source.js';
import type { CredentialId, CredentialSource } from './types.js';

export interface CredentialBus {
  /** Presence check across all sources (MasterKey-free). */
  hasCredential(id: CredentialId): Promise<boolean>;
  /**
   * Retrieve the plaintext key from the first source that serves `id`
   * (MasterKey-gated). `null` when no source serves it. Propagates a crypto
   * throw from the underlying source on a wrong/absent MasterKey.
   */
  getCredentialKey(id: CredentialId, mk: MasterKey): Promise<string | null>;
}

/**
 * Build a credential bus over an ordered source list. Dispatch is first-match:
 * `hasCredential` is true as soon as a source serves the id; `getCredentialKey`
 * returns the first non-null source result. Exported as a factory so tests can
 * inject fake sources.
 */
export function createCredentialBus(sources: CredentialSource[]): CredentialBus {
  return {
    async hasCredential(id) {
      for (const source of sources) {
        if (await source.has(id)) return true;
      }
      return false;
    },
    async getCredentialKey(id, mk) {
      for (const source of sources) {
        const key = await source.get(id, mk);
        if (key !== null) return key;
      }
      return null;
    },
  };
}

/**
 * The default application bus. Today it carries the single provider-key source;
 * a future standalone-key source is appended here.
 */
const defaultBus = createCredentialBus([providerKeySource]);

/** Presence check via the default bus. MasterKey-free. */
export const hasCredential = (id: CredentialId): Promise<boolean> => defaultBus.hasCredential(id);

/** Retrieval via the default bus. MasterKey-gated. */
export const getCredentialKey = (id: CredentialId, mk: MasterKey): Promise<string | null> =>
  defaultBus.getCredentialKey(id, mk);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run tests/unit/credential-bus.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/credentials/credential-bus.ts \
        apps/user-client/tests/unit/credential-bus.test.ts
git commit -m "Add credential-bus facade with first-match source dispatch"
```

---

### Task 3: Reactive `useCredential` hook

**Files:**
- Create: `apps/user-client/src/credentials/use-credential.ts`
- Test: `apps/user-client/tests/unit/use-credential.test.tsx`

**Key design point:** the hook's query key is `['providers', 'credential', id]`. It
shares the `['providers']` prefix, so the existing `qc.invalidateQueries({ queryKey: QK.providers })`
calls inside `useUpsertProvider`/`useDeleteProvider` (`src/data/providers.ts`)
automatically refetch it — that is the reactivity. The hook exposes presence
only, never the plaintext.

- [ ] **Step 1: Write the failing test** `use-credential.test.tsx`

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { useDeleteProvider, useUpsertProvider } from '../../src/data/providers.js';
import { useCredential } from '../../src/credentials/use-credential.js';

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const DUMMY_BLOB = {
  ciphertext: new Uint8Array([1]),
  nonce: new Uint8Array([2]),
  version: 1 as const,
};

describe('useCredential', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('reflects presence reactively across upsert and delete', async () => {
    const W = wrapper();
    const cred = renderHook(() => useCredential('nano-gpt'), { wrapper: W });
    const upsert = renderHook(() => useUpsertProvider(), { wrapper: W });
    const del = renderHook(() => useDeleteProvider(), { wrapper: W });

    await waitFor(() => expect(cred.result.current.present).toBe(false));

    let id = '';
    await act(async () => {
      const r = await upsert.result.current.mutateAsync({
        templateId: 'nano-gpt',
        apiKey: DUMMY_BLOB,
        enabled: true,
      });
      id = r.id;
    });
    await waitFor(() => expect(cred.result.current.present).toBe(true));

    await act(async () => {
      await del.result.current.mutateAsync(id);
    });
    await waitFor(() => expect(cred.result.current.present).toBe(false));
  });

  it('reports false for a disabled provider', async () => {
    const W = wrapper();
    const cred = renderHook(() => useCredential('nano-gpt'), { wrapper: W });
    const upsert = renderHook(() => useUpsertProvider(), { wrapper: W });

    await act(async () => {
      await upsert.result.current.mutateAsync({
        templateId: 'nano-gpt',
        apiKey: DUMMY_BLOB,
        enabled: false,
      });
    });
    await waitFor(() => expect(cred.result.current.isLoading).toBe(false));
    expect(cred.result.current.present).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter user-client exec vitest run tests/unit/use-credential.test.tsx`
Expected: FAIL — `Cannot find module '../../src/credentials/use-credential.js'`

- [ ] **Step 3: Write `use-credential.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from '@tanstack/react-query';
import { hasCredential } from './credential-bus.js';
import type { CredentialId, CredentialPresence } from './types.js';

/**
 * Reactive credential-presence hook for integration UI. Returns presence only —
 * never the plaintext key (retrieval is an explicit MasterKey-gated call via
 * `getCredentialKey` at the point of need).
 *
 * The query key shares the `['providers']` prefix, so the invalidations in
 * `useUpsertProvider`/`useDeleteProvider` refetch it automatically when the
 * user adds or removes a key.
 */
export function useCredential(id: CredentialId): CredentialPresence {
  const query = useQuery({
    queryKey: ['providers', 'credential', id],
    queryFn: () => hasCredential(id),
  });
  return { present: query.data ?? false, isLoading: query.isLoading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter user-client exec vitest run tests/unit/use-credential.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the three new test files together + typecheck**

Run: `pnpm --filter user-client exec vitest run tests/unit/credential-provider-source.test.ts tests/unit/credential-bus.test.ts tests/unit/use-credential.test.tsx`
Expected: PASS (14 tests total)
Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/credentials/use-credential.ts \
        apps/user-client/tests/unit/use-credential.test.tsx
git commit -m "Add reactive useCredential presence hook"
```

---

### Task 4: Documentation (ADR + architecture + security journal)

**Files:**
- Create: `obsidian/decisions/0033-credential-bus.md`
- Modify: `obsidian/ARCHITECTURE.md` (add a "Credential bus" section)
- Modify: `obsidian/insights/security-deferrals.md` (add a note)

This is a doc-only task — the commit subject gets the `[skip ci]` tag.

- [ ] **Step 1: Write the ADR** `obsidian/decisions/0033-credential-bus.md`

Use the Michael-Nygard style of the existing ADRs (read `obsidian/decisions/0032-premium-censored-models-via-routers.md` for the exact heading shape). Content to capture:

```markdown
# 0033 — Credential bus as the integration credential boundary

## Status

Accepted (2026-06-01).

## Context

Future integrations (e.g. showing the user their nano-gpt usage and account
balance) need to ask "does the user have an API key for X, and if so, use it".
For the cases we have today, that key already exists — the user entered it as an
LLM provider. We want a single, documented place to answer that question rather
than scattering provider-row lookups across the codebase, and we want it ready
before the first integration lands.

## Decision

Introduce a client-side **credential bus** (`apps/user-client/src/credentials/`):

1. **Source: pass through existing provider keys.** The bus reads enabled
   `ProviderRow`s; no duplicate entry, no separate store for today's cases.
2. **Identity: abstract `CredentialId`.** Consumers ask for a named id
   (`'nano-gpt'`). The bus encapsulates the source via a `CredentialSource`
   interface; today the only source is `providerKeySource`, where
   `credentialId === templateId`.
3. **Query plus reactive surface.** `hasCredential`/`getCredentialKey`
   (imperative) and `useCredential` (a reactive TanStack hook). Presence is
   MasterKey-free; retrieval is MasterKey-gated via `openSecret`. The reactive
   hook exposes presence only, never the plaintext.
4. **`enabled` gating.** Presence is reported only when the provider row is
   `enabled`.

## Consequences

- Disabling a provider as a chat route also hides any integration that depends
  on its key. Conscious coupling; a future revision could decouple "credential
  present" from "LLM route active" by dropping the `enabled` filter.
- No new persistence and no Dexie migration — the bus reads existing rows.
- A new access surface to unsealed keys (it calls `openSecret`). It changes no
  crypto primitive; noted in the security journal.
- The standalone-key source (a key with no LLM provider behind it — e.g. a LAN
  actuator), and an integration manager that auto-activates/deactivates on key
  changes, are documented future work, out of scope here. The reactive hook is
  the primitive they will build on.

## References

- Spec: `superpowers/specs/2026-06-01-credential-bus-design.md`
- Plan: `superpowers/plans/2026-06-01-credential-bus.md`
```

- [ ] **Step 2: Add the ARCHITECTURE.md section**

Open `obsidian/ARCHITECTURE.md`, find a sensible place (after the client storage / provider section), and add:

```markdown
## Credential bus

`apps/user-client/src/credentials/` answers "does the user have an API key for
credential X, and if so, give it to me." It is the single boundary integrations
use to reach stored API keys, rather than reading provider rows directly.

- **Source abstraction.** A `CredentialSource` array, queried first-match. Today
  the only source is `providerKeySource`, which passes through enabled
  `ProviderRow`s (`credentialId === templateId`). A standalone-key source (keys
  with no LLM provider behind them) is the documented future extension.
- **Presence vs retrieval.** `hasCredential(id)` is MasterKey-free (row
  existence). `getCredentialKey(id, mk)` is MasterKey-gated and opens the sealed
  key via `openSecret`, the same path the chat send uses.
- **Reactive.** `useCredential(id)` returns presence only and updates
  automatically when the user adds or removes a key (it shares the `providers`
  query prefix). Integration UI builds on this; the plaintext is never exposed
  reactively.

See ADR 0033 and `superpowers/specs/2026-06-01-credential-bus-design.md`.
```

(If `ARCHITECTURE.md` is still a stub/`TBD`, add the section under a top-level
heading anyway — it stands alone.)

- [ ] **Step 3: Add the security-journal note**

Append to `obsidian/insights/security-deferrals.md` (match its existing entry
format):

```markdown
## Credential bus — new access surface to unsealed keys (2026-06-01)

The credential bus (`apps/user-client/src/credentials/`) is a new place that
calls `openSecret` to return decrypted provider API keys to in-app consumers
(future integrations). It changes no crypto primitive and adds no storage, but
it widens *who* can request a decrypted key beyond the chat send path. Not a
Larissa-gated change (no `auth-/sync-/proxy-service` or `packages/crypto`
touch). Follow-up to watch when the first integration lands: ensure integration
code retrieves keys only at the point of an outbound call and does not persist
or log the plaintext.
```

- [ ] **Step 4: Commit (doc-only, `[skip ci]`)**

```bash
git add obsidian/decisions/0033-credential-bus.md \
        obsidian/ARCHITECTURE.md \
        obsidian/insights/security-deferrals.md
git commit -m "Document credential bus (ADR 0033, architecture, security note) [skip ci]"
```

---

## Final verification (after all tasks)

- [ ] **Full user-client suite** — confirm no regression beyond the known
  baseline:

Run: `pnpm --filter user-client exec vitest run`
Expected: the three new files green (14 new tests); the pre-existing 8
`chat-page`/`chat-route`/`cockpit-draft` localStorage-jsdom failures unchanged
(baseline per STATUS-CLIENT-ONLY), nothing else newly red.

- [ ] **Typecheck (CI gate):**

Run: `pnpm typecheck`
Expected: PASS (13/13 packages, no new errors).

- [ ] **Hand back to Liz** for the STATUS-CLIENT-ONLY.md update and squash. (No
  push, no branch switch by subagents.)

---

## Notes for the implementer

- **Do not** wire the bus into any existing call site (e.g. `send-message.ts`).
  This unit only *adds* the bus; `send-message` keeps opening its key directly.
  Re-pointing existing consumers at the bus is explicitly out of scope.
- `getClientDataDb()` throws if the DB is not open — that is why each Dexie test
  calls `openClientDataDb()` in `beforeEach`. The bus functions assume the DB is
  already open at call time (it is, post-boot), exactly like `src/data/*.ts`.
- If `pnpm --filter user-client exec vitest` is not the runner invocation used
  elsewhere, mirror whatever `apps/user-client/package.json`'s `test` script
  does; the import paths and assertions stand regardless of the runner flags.
