# Provider uniqueness by template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee one provider row per provider template by making a provider row's `id` value equal its `templateId`, so cross-device sync converges automatically and duplicate rows (e.g. two `nano-gpt`) cannot exist.

**Architecture:** Keep the Dexie keyPath `id`; change the *value* written to `id` from `uuidv7()` to `templateId`. The provider sync key is already `row.id` (`sync-keys.ts:40`), so identical `id`s across devices merge under one blindId. A new unindexed `keySlot` field decouples the API-key seal context (`provider/<keySlot>/api-key`) from `id`, so the existing sealed blobs survive the id rewrite with **no re-seal and no MasterKey in the migration**. A Dexie `version(35)` data migration dedups and rekeys existing rows.

**Tech Stack:** TypeScript (strict), Dexie (IndexedDB), `@serenity-kit`/WebCrypto secrets, TanStack Query, Vitest + fake-indexeddb.

**Spec:** [`superpowers/specs/2026-07-06-provider-key-uniqueness-design.md`](../specs/2026-07-06-provider-key-uniqueness-design.md)

## Global Constraints

- **Load-bearing assumption (confirm before executing):** the encrypted backend is pre-alpha/dev-only (live at v0.3.0/Block 6). No real accounts have provider rows synced to a server, so **no server-side republish of pre-existing duplicates is in scope** (spec §5.3).
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justifying comment.
- **Biome bans the non-null assertion `!`.** Never write `x!`; narrow explicitly.
- British English in all code, comments, commit messages.
- Tests live under `apps/user-client/tests/**`. Run `pnpm --filter @chatsundere/user-client typecheck --force` and `pnpm --filter @chatsundere/user-client test` (full suite, not `--force`-cached) before each commit; the pre-commit hook runs Biome only.
- Dexie version after this work is **35**. `keySlot` is unindexed (rides free); the bump is needed only to run the data migration.
- Commit trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Do not push, merge, or switch branches.

---

### Task 1: Deterministic dedup rule

**Files:**
- Create: `apps/user-client/src/data/provider-dedup.ts`
- Test: `apps/user-client/tests/unit/provider-dedup.test.ts`

**Interfaces:**
- Produces: `pickProviderSurvivor(rows: ProviderRow[]): ProviderRow` — the single survivor for a group of rows sharing a `templateId`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/user-client/tests/unit/provider-dedup.test.ts
import { describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { pickProviderSurvivor } from '../../src/data/provider-dedup.js';

const base: Omit<ProviderRow, 'id' | 'enabled' | 'updatedAt'> = {
  templateId: 'nano-gpt',
  displayName: 'nano-gpt',
  baseUrl: '',
  apiKey: { version: 1, ciphertext: new Uint8Array(), nonce: new Uint8Array() },
  routing: { kind: 'direct' },
  createdAt: 0,
};
const row = (id: string, enabled: boolean, updatedAt: number): ProviderRow => ({
  ...base,
  id,
  enabled,
  updatedAt,
});

describe('pickProviderSurvivor', () => {
  it('prefers an enabled row over a disabled one regardless of updatedAt', () => {
    const enabledOld = row('a', true, 1);
    const disabledNew = row('b', false, 999);
    expect(pickProviderSurvivor([disabledNew, enabledOld]).id).toBe('a');
  });

  it('among same-enabled rows prefers the higher updatedAt', () => {
    expect(pickProviderSurvivor([row('a', true, 5), row('b', true, 9)]).id).toBe('b');
  });

  it('breaks a full tie by lexicographically smaller id (deterministic)', () => {
    expect(pickProviderSurvivor([row('zzz', true, 5), row('aaa', true, 5)]).id).toBe('aaa');
  });

  it('is order-independent', () => {
    const rows = [row('a', false, 5), row('b', true, 1), row('c', true, 9)];
    expect(pickProviderSurvivor([...rows].reverse()).id).toBe('c');
    expect(pickProviderSurvivor(rows).id).toBe('c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test provider-dedup`
Expected: FAIL — `pickProviderSurvivor` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/user-client/src/data/provider-dedup.ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderRow } from '../boot/client-data-db.js';

/**
 * Pick the single survivor among provider rows sharing a `templateId` (spec §5.2).
 * A total order, so every device converges on the same winner: an enabled row
 * beats a disabled one; else the higher `updatedAt` wins; else the
 * lexicographically smaller `id` is the deterministic tiebreak. `rows` must be
 * non-empty.
 */
export function pickProviderSurvivor(rows: ProviderRow[]): ProviderRow {
  return rows.reduce((best, r) => {
    if (r.enabled !== best.enabled) return r.enabled ? r : best;
    if (r.updatedAt !== best.updatedAt) return r.updatedAt > best.updatedAt ? r : best;
    return r.id < best.id ? r : best;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test provider-dedup`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/data/provider-dedup.ts apps/user-client/tests/unit/provider-dedup.test.ts
git commit -m "Add deterministic provider dedup rule

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Decouple the seal context via `keySlot`

Adds the `keySlot` field and a single helper for the API-key slot id, then routes
every read/open site through it. The helper falls back to `row.id` when `keySlot`
is absent, so this task is safe to land *before* the migration (Task 3): existing
rows have no `keySlot` and resolve to `provider/<id>/api-key` exactly as today.

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (add `keySlot?` to `ProviderRow`)
- Modify: `apps/user-client/src/data/providers.ts` (add + export `providerApiKeySlot`)
- Modify: `apps/user-client/src/credentials/sources/provider-key-source.ts:40`
- Modify: `apps/user-client/src/lib/voice/voice-transport.ts:48`
- Modify: `apps/user-client/src/memory/resolve-args.ts:45`
- Modify: `apps/user-client/src/data/send-message.ts` (three `provider/${…}/api-key` sites)
- Test: `apps/user-client/tests/unit/provider-key-slot.test.ts`

**Interfaces:**
- Consumes: `ProviderRow` (Task-none; existing).
- Produces: `providerApiKeySlot(row: Pick<ProviderRow, 'id' | 'keySlot'>): string` — the AAD slot id for a provider's sealed API key.

- [ ] **Step 1: Add the `keySlot` field**

In `client-data-db.ts`, inside `export interface ProviderRow`, add after `apiKey`:

```ts
  /** The AAD slot the `apiKey` blob is sealed under: `provider/<keySlot>/api-key`.
   *  Decoupled from `id` so the v35 id→templateId rekey preserves existing sealed
   *  blobs without a re-seal (spec §4). Absent on pre-v35 rows → callers fall back
   *  to `id`. Non-indexed (schemaless) — no Dexie version bump of its own. */
  keySlot?: string;
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/user-client/tests/unit/provider-key-slot.test.ts
import { describe, expect, it } from 'vitest';
import { providerApiKeySlot } from '../../src/data/providers.js';

describe('providerApiKeySlot', () => {
  it('uses keySlot when present', () => {
    expect(providerApiKeySlot({ id: 'nano-gpt', keySlot: 'old-uuid' })).toBe(
      'provider/old-uuid/api-key',
    );
  });
  it('falls back to id when keySlot is absent (pre-v35 row)', () => {
    expect(providerApiKeySlot({ id: 'old-uuid' })).toBe('provider/old-uuid/api-key');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test provider-key-slot`
Expected: FAIL — `providerApiKeySlot` not exported.

- [ ] **Step 4: Implement the helper**

In `apps/user-client/src/data/providers.ts`, add near the top (after imports):

```ts
/**
 * The AAD slot id a provider's `apiKey` is sealed under. Reads `keySlot`, falling
 * back to `id` for pre-v35 rows sealed before the field existed (spec §4).
 */
export function providerApiKeySlot(row: Pick<ProviderRow, 'id' | 'keySlot'>): string {
  return `provider/${row.keySlot ?? row.id}/api-key`;
}
```

- [ ] **Step 5: Route every open site through the helper**

Replace each literal `` `provider/${…}/api-key` `` open context with `providerApiKeySlot(row)`:

- `credentials/sources/provider-key-source.ts:40` — `openSecret(row.apiKey, mk, providerApiKeySlot(row))` (import from `../../data/providers.js`).
- `lib/voice/voice-transport.ts:48` — `openSecret(providerRow.apiKey, mk, providerApiKeySlot(providerRow))`.
- `memory/resolve-args.ts:45` — `openSecret(provider.apiKey, mk, providerApiKeySlot(provider))`.
- `data/send-message.ts` — the three `openSecret(provider.apiKey|providerRow.apiKey, mk, \`provider/${…}/api-key\`)` sites → `providerApiKeySlot(<that row var>)`.

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @chatsundere/user-client test provider-key-slot`
Expected: PASS (2 tests).
Run: `pnpm --filter @chatsundere/user-client typecheck --force`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src apps/user-client/tests/unit/provider-key-slot.test.ts
git commit -m "Decouple provider API-key seal context via keySlot

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Dexie v35 migration — dedup + rekey `id` to `templateId`

Runs the one-time data migration and sweeps the hard-coded `verno` assertions.

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (add `version(35)` block; import `pickProviderSurvivor`)
- Test: `apps/user-client/tests/boot/client-data-db-v35.test.ts`
- Modify (sweep): every test asserting `expect(db.verno).toBe(34)` → `35` (33 occurrences).

**Interfaces:**
- Consumes: `pickProviderSurvivor` (Task 1), `providerApiKeySlot` (Task 2).

- [ ] **Step 1: Write the failing migration test**

```ts
// apps/user-client/tests/boot/client-data-db-v35.test.ts
import 'fake-indexeddb/auto';
import { asMasterKey, getRandomBytes, type MasterKey } from '@chatsundere/crypto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
  type ProviderRow,
} from '../../src/boot/client-data-db.js';
import { providerApiKeySlot } from '../../src/data/providers.js';
import { openSecret, sealSecret } from '../../src/lib/secrets.js';

/** Minimal v34 store set — Dexie creates the rest at head-open. */
const V34_MIN_STORES = { settings: 'id', providers: 'id, templateId, enabled' } as const;

const mk: MasterKey = asMasterKey(getRandomBytes(32));

async function plantV34(providers: ProviderRow[]): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  db.version(34).stores(V34_MIN_STORES);
  await db.open();
  await db.table('providers').bulkAdd(providers);
  db.close();
}

function provRow(id: string, enabled: boolean, updatedAt: number, apiKey: ProviderRow['apiKey']): ProviderRow {
  return {
    id,
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: '',
    apiKey,
    routing: { kind: 'direct' },
    enabled,
    createdAt: 0,
    updatedAt,
  };
}

describe('client-data-db v35 (provider id → templateId)', () => {
  beforeEach(async () => await _resetClientDataDbForTests());
  afterEach(async () => await _resetClientDataDbForTests());

  it('opens at verno 35 on a fresh install', async () => {
    await openClientDataDb();
    expect(getClientDataDb().verno).toBe(35);
  });

  it('collapses two nano-gpt rows to one keyed by templateId, preserving the sealed key', async () => {
    // The survivor (enabled) is sealed under its OLD uuid slot.
    const survivorId = 'uuid-enabled';
    const sealed = await sealSecret('real-key', mk, `provider/${survivorId}/api-key`);
    const dud = await sealSecret('dud', mk, 'provider/uuid-disabled/api-key');
    await plantV34([
      provRow('uuid-disabled', false, 100, dud),
      provRow(survivorId, true, 50, sealed),
    ]);

    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(35);

    const rows = (await db.providers.where('templateId').equals('nano-gpt').toArray()) as ProviderRow[];
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.id).toBe('nano-gpt');
    expect(row?.keySlot).toBe(survivorId);
    // The preserved blob still opens under the keySlot-derived context.
    expect(await openSecret(row!.apiKey, mk, providerApiKeySlot(row!))).toBe('real-key');
    expect(await db.providers.get('uuid-disabled')).toBeUndefined();
    expect(await db.providers.get('uuid-enabled')).toBeUndefined();
  });

  it('rekeys a singleton provider and is idempotent on re-open', async () => {
    const sealed = await sealSecret('k', mk, 'provider/uuid-x/api-key');
    await plantV34([{ ...provRow('uuid-x', true, 1, sealed), templateId: 'openrouter', displayName: 'openrouter' }]);
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const first = await getClientDataDb().providers.get('openrouter');
    expect(first?.id).toBe('openrouter');
    expect(first?.keySlot).toBe('uuid-x');

    // Re-open (no version change) must not disturb the migrated row.
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();
    const again = await getClientDataDb().providers.get('openrouter');
    expect(again?.keySlot).toBe('uuid-x');
    expect(await getClientDataDb().providers.toArray()).toHaveLength(1);
  });
});
```

> The `row!` / `first?.` above are in a **test file** — Biome's non-null-assertion ban applies to `src`, and tests already use `?.`/`!` freely (see existing boot tests). Keep `expect(row?.id)` style; the single `row!.apiKey` mirrors existing test usage.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test client-data-db-v35`
Expected: FAIL — opens at verno 34 (no `version(35)` yet), rows keyed by uuid.

- [ ] **Step 3: Add the `version(35)` migration**

In `client-data-db.ts`, add the import at the top:

```ts
import { pickProviderSurvivor } from '../data/provider-dedup.js';
```

Immediately after the `this.version(34)…` block, add:

```ts
    // Version 35 — provider identity: a provider row's `id` value becomes its
    // `templateId` so cross-device sync converges on one row per template (spec
    // §5). Dedup each templateId group to a deterministic survivor, re-insert it
    // under `id = templateId`, and stash its old id as `keySlot` so the sealed
    // apiKey (bound to `provider/<old id>/api-key`) opens unchanged — no re-seal,
    // no MasterKey needed. Idempotent: a row already keyed by its templateId is
    // simply re-put with its keySlot preserved. Stores are unchanged; the bump
    // exists only to run this data rewrite.
    this.version(35)
      .stores({ providers: 'id, templateId, enabled' })
      .upgrade(async (tx) => {
        const table = tx.table('providers');
        const rows = (await table.toArray()) as ProviderRow[];
        const byTemplate = new Map<string, ProviderRow[]>();
        for (const r of rows) {
          const group = byTemplate.get(r.templateId) ?? [];
          group.push(r);
          byTemplate.set(r.templateId, group);
        }
        for (const [templateId, group] of byTemplate) {
          const survivor = pickProviderSurvivor(group);
          for (const r of group) await table.delete(r.id);
          await table.put({ ...survivor, id: templateId, keySlot: survivor.keySlot ?? survivor.id });
        }
      });
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test client-data-db-v35`
Expected: PASS (3 tests).

- [ ] **Step 5: Sweep the verno assertions 34 → 35**

```bash
rg -l 'verno)\.toBe(34)' apps/user-client/tests \
  | xargs sed -i 's/verno)\.toBe(34)/verno).toBe(35)/g'
rg -c 'verno)\.toBe(35)' apps/user-client/tests   # sanity: ~33 hits, none left on 34
rg 'verno)\.toBe(34)' apps/user-client/tests && echo 'LEFTOVERS — fix manually' || echo 'clean'
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck --force`
Expected: no errors.
Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS except the known Node-localStorage baseline failures (expect exactly 8; a 9th is real). Every `verno` boot test now asserts 35.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests
git commit -m "Migrate provider rows to templateId-keyed identity (Dexie v35)

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Write path — create with `id = templateId`, single seal

Collapses `useUpsertProvider` and the three-write seal dance in the provider sheet
now that the id is known up front (it is the `templateId`).

**Files:**
- Modify: `apps/user-client/src/data/providers.ts` (`useUpsertProvider`, drop `uuidv7`)
- Modify: `apps/user-client/src/routes/app/settings/provider.tsx:72-149` (`onSave`)
- Test: `apps/user-client/tests/data/use-upsert-provider.test.ts`

**Interfaces:**
- Produces: `upsertProviderRow(args: UpsertArgs): Promise<ProviderRow>` — the React-free write core, keyed by `templateId`. `useUpsertProvider()` is a thin mutation wrapper over it.
- `UpsertArgs = { templateId: string; apiKey: ProviderRow['apiKey']; enabled: boolean }` (no `id`).

- [ ] **Step 1: Write the failing test**

Drives the real write core (not a raw `db.put`), in the default local-only link
state (so `mutateSynced` takes its passthrough branch and the create path enqueues
nothing) — the test exercises the actual code under test.

```ts
// apps/user-client/tests/data/upsert-provider-row.test.ts
import 'fake-indexeddb/auto';
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, getClientDataDb, openClientDataDb } from '../../src/boot/client-data-db.js';
import { upsertProviderRow } from '../../src/data/providers.js';
import { sealSecret } from '../../src/lib/secrets.js';

const mk = asMasterKey(getRandomBytes(32));
const seal = (v: string) => sealSecret(v, mk, 'provider/nano-gpt/api-key');

describe('upsertProviderRow (keyed by templateId)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => await _resetClientDataDbForTests());

  it('creates a row whose id equals its templateId, with keySlot = templateId', async () => {
    const row = await upsertProviderRow({ templateId: 'nano-gpt', apiKey: await seal('k1'), enabled: false });
    expect(row.id).toBe('nano-gpt');
    expect(row.keySlot).toBe('nano-gpt');
    expect((await getClientDataDb().providers.get('nano-gpt'))?.id).toBe('nano-gpt');
  });

  it('a second upsert of the same templateId updates in place — exactly one row', async () => {
    await upsertProviderRow({ templateId: 'nano-gpt', apiKey: await seal('a'), enabled: false });
    await upsertProviderRow({ templateId: 'nano-gpt', apiKey: await seal('b'), enabled: true });
    const db = getClientDataDb();
    expect(await db.providers.where('templateId').equals('nano-gpt').count()).toBe(1);
    expect((await db.providers.get('nano-gpt'))?.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test upsert-provider-row`
Expected: FAIL — `upsertProviderRow` is not exported.

- [ ] **Step 3: Extract the write core and thin the hook**

In `data/providers.ts`, remove the `import { uuidv7 } from 'uuidv7';` line, replace
the `UpsertArgs` interface and `useUpsertProvider`, and add the exported core:

```ts
export interface UpsertArgs {
  templateId: string;
  apiKey: ProviderRow['apiKey'];
  enabled: boolean;
}

/**
 * Create or update the single provider row for a template (React-free core). The
 * row's `id` IS its `templateId` (spec §5), so the sync key is deterministic
 * across devices and a second row cannot exist. A new row seals its api key under
 * its own templateId slot; an edit preserves the existing `keySlot` (which may be
 * a pre-v35 uuid).
 */
export async function upsertProviderRow(args: UpsertArgs): Promise<ProviderRow> {
  const db = getClientDataDb();
  const now = Date.now();
  const existing = await db.providers.get(args.templateId);
  const row: ProviderRow = existing
    ? { ...existing, apiKey: args.apiKey, enabled: args.enabled, updatedAt: now }
    : {
        id: args.templateId,
        templateId: args.templateId,
        displayName: args.templateId,
        baseUrl: '',
        apiKey: args.apiKey,
        routing: { kind: 'direct' },
        enabled: args.enabled,
        keySlot: args.templateId,
        createdAt: now,
        updatedAt: now,
      };

  if (existing) {
    // Class-2 edit (spec §5): gated synced write-through.
    await mutateSynced({
      collection: 'providers',
      key: row.id,
      tables: ['providers'],
      write: async (tx) => {
        await tx.table('providers').put(row);
      },
    });
  } else {
    const linked = isLinkedForSync();
    // Class-1 creation-insert: row + outbox row are atomic.
    await db.transaction('rw', [db.providers, db.syncOutbox], async (tx) => {
      await db.providers.add(row);
      if (linked) enqueueSync(tx, 'providers', row.id, 'upsert');
    });
    if (linked) scheduleClass1Sync();
  }
  return row;
}

/** Mutation wrapper over {@link upsertProviderRow} that invalidates the list. */
export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: upsertProviderRow,
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.providers }),
  });
}
```

- [ ] **Step 3b: Run to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test upsert-provider-row`
Expected: PASS (2 tests).

- [ ] **Step 4: Simplify the provider sheet `onSave`**

In `routes/app/settings/provider.tsx`, replace the seal/upsert block (lines ~91-139,
the `rowId`/`apiKeySlotId`/`stableSlotId` three-write dance) with a single seal:

```ts
      const keySlot = existing?.keySlot ?? templateId;
      const slotId = `provider/${keySlot}/api-key`;
      const sealedKey = apiKey ? await sealSecret(apiKey, mk, slotId) : existing?.apiKey;
      if (!sealedKey) {
        setSaving(false);
        return;
      }
      await upsert.mutateAsync({ templateId, apiKey: sealedKey, enabled: false });

      // Proxy-required providers route through the account's authenticated proxy,
      // read late at request-build time — nothing proxy-related is sealed here.
      const decryptedKey = await openSecret(sealedKey, mk, slotId);

      const config = {
        baseUrl: definition.baseUrl,
        routing: requiresProxy ? ({ kind: 'cors-proxy' } as const) : ({ kind: 'direct' } as const),
      };
      const result = await probeProvider({ definition, config, apiKey: decryptedKey });

      if (result.ok) {
        await upsert.mutateAsync({ templateId, apiKey: sealedKey, enabled: true });
        setStatus({ kind: 'ok' });
        back();
      } else {
        setStatus({ kind: 'error', reason: `${result.status} · ${result.reason ?? ''}` });
      }
```

- [ ] **Step 5: Run full suite + typecheck**

Run: `pnpm --filter @chatsundere/user-client typecheck --force`
Expected: no errors (the `id` arg is gone from every `upsert.mutateAsync` call).
Run: `pnpm --filter @chatsundere/user-client test`
Expected: PASS except the 8 known baseline failures.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/data/providers.ts apps/user-client/src/routes/app/settings/provider.tsx apps/user-client/tests/data/upsert-provider-row.test.ts
git commit -m "Key provider writes by templateId, collapse the seal dance

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Manual Verification (Chris, on-device)

1. `./reset-dev-auth.sh` → `./bootstrap-admin.sh`, register fresh on device A, add a `nano-gpt` key (verify probe succeeds and the key persists across reload).
2. Pair device B (or a second browser profile); confirm exactly **one** `nano-gpt` row syncs down.
3. On device B edit the `nano-gpt` key; device A converges to the edit — still **one** row.
4. Console probe: `(await getClientDataDb().providers.toArray())` shows one row per `templateId`, each with `id === templateId` and a `keySlot` present.

## Self-Review notes

- Spec §5.1 (id = templateId, keyPath unchanged) → Tasks 3 + 4. §4 (keySlot decoupling) → Task 2. §5.2 (dedup) → Tasks 1 + 3. §5.4 (write-path/consumer simplification) → Task 4. §7 (tests) → each task's tests. §5.3 (no republish) → Global Constraints assumption.
- Type consistency: `pickProviderSurvivor`, `providerApiKeySlot`, `UpsertArgs {templateId, apiKey, enabled}`, `keySlot?: string` used identically across tasks.
- No placeholders: every step carries runnable code or an exact command.
