# Deterministic Built-in Mindspace IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Built-in mindspaces get deterministic slug ids (`mindspace-builtin-<name>`) plus a Dexie v36 rekey-and-remap migration, so the synced reference fields (`settings.defaultMindspaceId`, `personas.mindspaceId`, `chats.resolvedMindspaceId`) converge across devices instead of dangling — pre-test-analysis finding #5.

**Spec:** [`superpowers/specs/2026-07-07-builtin-mindspace-deterministic-ids-design.md`](../specs/2026-07-07-builtin-mindspace-deterministic-ids-design.md)

**Architecture:** The v35 provider-identity pattern applied to mindspaces. `BUILT_IN_MINDSPACES` in `apps/user-client/src/boot/client-data-db.ts` gains a fixed `id` slug per entry and becomes the single source of truth; seeding uses those slugs instead of `uuidv7()`; a Dexie v36 upgrade rekeys existing built-in rows and remaps every referencing store **in the same transaction**. Built-ins stay excluded from sync (no engine change — comments only).

**Tech Stack:** TypeScript strict, Dexie 4, Vitest + fake-indexeddb, Biome, pnpm 9 / Turborepo.

## Operating rules for the overnight worker (READ FIRST)

These rules are binding and override your defaults. The repo's CLAUDE.md and this
session's conventions are NOT assumed to be in your context — everything you need is
in this section and the tasks below.

1. **Branch.** Work on a dedicated branch cut from `master` tip — intended name
   `fix/builtin-mindspace-ids`; if your harness assigns a `claude/...` name instead,
   that is fine, just report it. **Never commit to `master`. Do NOT merge and do NOT
   push-to-master; stop at Task 5 (hand-off).**
2. **STOP-guard before any edit.** Open `apps/user-client/src/boot/client-data-db.ts`
   and check: `this.version(35)` must be the highest Dexie version and
   `this.version(36)` must NOT exist. If v36 already exists, a parallel branch claimed
   it — STOP and report; do not renumber silently.
3. **Baseline first (Step 0).** On the untouched checkout run
   `pnpm -C apps/user-client test`. Expect **exactly 8 failures** — a known
   environmental baseline (Node's experimental `localStorage` shim; the failures
   cluster in localStorage-dependent test files). Record the failing file names. Every
   later full run must fail in **exactly those files, exactly 8** — a 9th failure is a
   real regression you introduced; fix it, never explain it away as "pre-existing"
   without confirming it fails identically on `master`.
4. **Language.** Every text artefact — code, comments, test names, commit messages,
   doc edits — is **British English** (`colour`, `initialise`, `behaviour`). No US
   spelling, no German, anywhere in the repo.
5. **TDD per task.** Failing test → run to confirm it fails → minimal implementation →
   run to confirm it passes → commit. The tasks are already structured this way;
   follow the step order.
6. **Execution discipline.** Use subagent-driven development (one fresh subagent per
   task, two-stage review: spec-compliance then code-quality) if your harness supports
   subagents; otherwise execute the tasks yourself in order, treating each task's
   final step as a review checkpoint. Subagents never merge, push, or switch branches.
7. **Verification is full-suite, never touched-dirs-only.** The gate commands, exact
   and copy-pasteable, all from the repo root:
   - `pnpm typecheck --force` → expect **14/14** tasks successful (`--force` is
     mandatory — Turborepo caches typecheck and a cached pass lies on test-only
     changes).
   - `pnpm -C apps/user-client test` → full user-client vitest; green apart from the
     8-failure baseline (rule 3).
   - `pnpm run build` → expect **9/9** tasks successful (build and typecheck diverge
     subtly; run both at the end).
8. **Commit hygiene.** Biome runs as the lefthook pre-commit gate (it bans non-null
   assertions `!`); never bypass it with `--no-verify`. Commit messages: free-form
   imperative, subject capitalised, no Conventional-Commits prefix. Doc-only commits
   append ` [skip ci]` (exact form, with the space). Every commit ends with:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
9. **Security boundary.** This plan does NOT touch the security-audit paths
   (`apps/auth-service`, `apps/sync-service`, `apps/proxy-service`,
   `packages/crypto`) — the `apps/user-client/src/sync/*` edits in Task 3 are
   comment-only. The security audit (Larissa) runs post-run on the controller side;
   you do not need to and cannot summon her. Do not expand scope into those paths.
10. **STATUS files.** Do NOT edit `obsidian/STATUS-BACKEND.md` or
    `obsidian/STATUS-CLIENT-ONLY.md` — the controller updates them at integration
    (avoids collisions with parallel sessions). The only docs you touch are the two
    named in Task 4.
11. **Scope.** Implement exactly this plan. If you hit something that seems to demand
    a design decision not covered here, STOP on that task, note it in the hand-off
    report, and continue with independent tasks if any remain.

## Global Constraints

- Every text artefact is **British English** (code, comments, commit messages, docs).
- Biome is the commit gate (lefthook) and **bans non-null assertions (`!`)** — never use them.
- Tests live under `apps/user-client/tests/**`, never next to sources.
- Comments explain non-obvious *why*, never restate code.
- Commit messages: free-form imperative, subject capitalised, no Conventional-Commits prefix; end with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
- Doc-only commits append ` [skip ci]` to the subject (exact form, with the space).
- Gate commands: `pnpm typecheck --force` (repo root, expect 14/14) and `pnpm -C apps/user-client test` (full user-client vitest — expect green apart from the known 8-failure Node-localStorage baseline: exactly 8 environmental failures in the `localStorage` trio; a 9th failure is real).
- **Dexie version 36 belongs to this plan.** If `src/boot/client-data-db.ts` already contains `this.version(36)` when work starts, STOP — a parallel branch claimed it; report instead of renumbering silently.

---

### Task 1: Slug ids in `BUILT_IN_MINDSPACES` + seeding

The seven built-ins get fixed slug ids; seeding stops minting `uuidv7()`. The existence check stays **displayName-keyed** (deliberate: it is correct in every DB state, including a pre-v36 DB that still holds uuid built-ins — id-keyed detection would double-seed there). Only *new* rows get slug ids; the v36 migration (Task 2) converts existing rows.

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts:1485-1565` (constant + `seedBuiltinsIfNeeded`)
- Test: `apps/user-client/tests/unit/client-data-db.test.ts`

**Interfaces:**
- Produces: `BUILT_IN_MINDSPACES: ReadonlyArray<{ id: string; displayName: string; accent: string }>` (module-private constant in `client-data-db.ts`; Task 2's migration reads it in the same file). Slugs, exactly: `mindspace-builtin-crimson`, `mindspace-builtin-aurum`, `mindspace-builtin-verdan`, `mindspace-builtin-azuro`, `mindspace-builtin-indigaut`, `mindspace-builtin-violetta`, `mindspace-builtin-rosari`.

- [ ] **Step 1: Extend the seeding tests to pin slug ids**

In `apps/user-client/tests/unit/client-data-db.test.ts`, replace the test `'seeds seven built-in mindspaces on first open'` (lines 38-52) with:

```ts
  it('seeds seven built-in mindspaces with deterministic slug ids on first open', async () => {
    const db = await openClientDataDb();
    const all = await db.mindspaces.toArray();
    const ids = all.map((m) => m.id).sort();
    expect(ids).toEqual([
      'mindspace-builtin-aurum',
      'mindspace-builtin-azuro',
      'mindspace-builtin-crimson',
      'mindspace-builtin-indigaut',
      'mindspace-builtin-rosari',
      'mindspace-builtin-verdan',
      'mindspace-builtin-violetta',
    ]);
    expect(all.every((m: MindspaceRow) => m.builtIn === true)).toBe(true);
  });
```

And in the test `'seeds the settings singleton with Aurum as default mindspace'` (lines 54-65), replace the two Aurum lines

```ts
    const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
    expect(aurum).toBeDefined();
    expect(settings?.defaultMindspaceId).toBe(aurum?.id);
```

with:

```ts
    expect(settings?.defaultMindspaceId).toBe('mindspace-builtin-aurum');
```

Do NOT touch any `verno` assertion in this task — the version stays 35 until Task 2.

- [ ] **Step 2: Run the file to verify the new assertions fail**

Run: `pnpm -C apps/user-client vitest run tests/unit/client-data-db.test.ts`
Expected: FAIL — the seeded ids are uuidv7 strings, not slugs.

- [ ] **Step 3: Implement — slugs in the constant, seeding uses them**

In `apps/user-client/src/boot/client-data-db.ts`, replace the constant (lines 1485-1493):

```ts
/**
 * The seven built-in mindspaces. `id` is a deterministic, self-describing slug —
 * identical on every device — so the synced reference fields
 * (`settings.defaultMindspaceId`, `personas.mindspaceId`,
 * `chats.resolvedMindspaceId`) converge across devices (the v35 provider-identity
 * pattern; pre-test-analysis #5). Ids are immutable identity: mutable attributes
 * (accent, texture) deliberately stay out of the slug.
 */
const BUILT_IN_MINDSPACES: ReadonlyArray<{ id: string; displayName: string; accent: string }> = [
  { id: 'mindspace-builtin-crimson', displayName: 'Crimson', accent: '#b33a5e' },
  { id: 'mindspace-builtin-aurum', displayName: 'Aurum', accent: '#c9a84c' },
  { id: 'mindspace-builtin-verdan', displayName: 'Verdan', accent: '#6aa97a' },
  { id: 'mindspace-builtin-azuro', displayName: 'Azuro', accent: '#4a7eb3' },
  { id: 'mindspace-builtin-indigaut', displayName: 'Indigaut', accent: '#5d4e9e' },
  { id: 'mindspace-builtin-violetta', displayName: 'Violetta', accent: '#9a5bb8' },
  { id: 'mindspace-builtin-rosari', displayName: 'Rosari', accent: '#c97a99' },
];
```

In `seedBuiltinsIfNeeded`, change the bulkAdd (line 1516):

```ts
        missingBuiltins.map((b) => buildMindspace(b.id, b.displayName, b.accent, now)),
```

And the settings seed (lines 1528-1529):

```ts
      const aurum = await db.mindspaces.get('mindspace-builtin-aurum');
      const aurumId =
        aurum?.id ?? (await db.mindspaces.toCollection().first())?.id ?? 'mindspace-builtin-aurum';
```

The `missingBuiltins` filter itself (line 1500, displayName-keyed) stays as it is.

Then check whether `uuidv7` is still used anywhere in the file: `rg -n "uuidv7\(" apps/user-client/src/boot/client-data-db.ts`. The two seeding call-sites above were the only calls — remove the now-unused `import { uuidv7 } from 'uuidv7';` (line 6). (The word appears in comments elsewhere in the file; only the import and calls matter.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C apps/user-client vitest run tests/unit/client-data-db.test.ts`
Expected: PASS (all tests in the file, including the untouched v2-migration block).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck --force` — expect 14/14.

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests/unit/client-data-db.test.ts
git commit -m "Seed built-in mindspaces with deterministic slug ids

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: Dexie v36 rekey-and-remap migration + verno sweep

The migration rekeys existing built-in rows (uuid → slug) and remaps every referencing store **in the same upgrade transaction** (the v35 lesson: an identity-changing migration must remap all back-references atomically): `settings.defaultMindspaceId`, `personas.mindspaceId`, `chats.resolvedMindspaceId`, and the row snapshots inside `trash` entries for personas/chats (a trashcan restore must not resurrect a dead uuid reference). The verno sweep (35 → 36 in every hard-coded assertion) is part of this task — the suite cannot be green between "v36 exists" and "the sweep ran".

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` (new `this.version(36)` block after v35, which ends at line 1417)
- Create: `apps/user-client/tests/boot/client-data-db-v36.test.ts`
- Modify (verno sweep, `expect(...verno).toBe(35)` → `36` — 35 assertions in 22 files):
  - `tests/boot/client-data-db-blob-fields.test.ts:32`
  - `tests/boot/client-data-db.imagegen.test.ts:15`
  - `tests/boot/client-data-db-v21.test.ts:101,118`
  - `tests/boot/client-data-db-v22.test.ts:106,123,137`
  - `tests/boot/client-data-db-v23.test.ts:76,92`
  - `tests/boot/client-data-db-v24.test.ts:78,94`
  - `tests/boot/client-data-db-v27.test.ts:50,60`
  - `tests/boot/client-data-db-v29.test.ts:21`
  - `tests/boot/client-data-db-v30.test.ts:80,115`
  - `tests/boot/client-data-db-v35.test.ts:91,107`
  - `tests/boot/client-data-db-v7.test.ts:106,151`
  - `tests/boot/client-data-db-v9.test.ts:73,84`
  - `tests/boot/client-data-db.webinterfacing.test.ts:19`
  - `tests/boot/knowledge-schema.test.ts:18`
  - `tests/boot/sync-schema.test.ts:157,171`
  - `tests/boot/trash-v34-upgrade.test.ts:74,83`
  - `tests/data/seed-templates.test.ts:26`
  - `tests/unit/artefacts-schema.test.ts:16`
  - `tests/unit/attachments-schema.test.ts:17`
  - `tests/unit/client-data-db.test.ts:20,29`
  - `tests/unit/expert-web-migration.test.ts:15`
  - `tests/unit/roleplay-schema.test.tsx:86`

**Interfaces:**
- Consumes: `BUILT_IN_MINDSPACES` with `id` slugs (Task 1, same file).
- Produces: DB verno 36. No exported symbol changes.

- [ ] **Step 1: Write the failing migration tests**

Create `apps/user-client/tests/boot/client-data-db-v36.test.ts` (modelled on the v35 file — plant a pre-migration DB with raw Dexie, then open through the real entrypoint):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MindspaceRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Minimal v35 store set — Dexie creates the rest at head-open. */
const V35_MIN_STORES = {
  settings: 'id',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  trash: 'id, purgeAt, rootGroup',
} as const;

/** The seven built-ins as a pre-v36 device seeded them: per-device uuids. */
const LEGACY_BUILTINS: ReadonlyArray<{ oldId: string; displayName: string }> = [
  { oldId: 'uuid-crimson', displayName: 'Crimson' },
  { oldId: 'uuid-aurum', displayName: 'Aurum' },
  { oldId: 'uuid-verdan', displayName: 'Verdan' },
  { oldId: 'uuid-azuro', displayName: 'Azuro' },
  { oldId: 'uuid-indigaut', displayName: 'Indigaut' },
  { oldId: 'uuid-violetta', displayName: 'Violetta' },
  { oldId: 'uuid-rosari', displayName: 'Rosari' },
];

const SLUGS = [
  'mindspace-builtin-aurum',
  'mindspace-builtin-azuro',
  'mindspace-builtin-crimson',
  'mindspace-builtin-indigaut',
  'mindspace-builtin-rosari',
  'mindspace-builtin-verdan',
  'mindspace-builtin-violetta',
];

function legacyMindspace(oldId: string, displayName: string): Record<string, unknown> {
  return {
    id: oldId,
    displayName,
    palette: { accent: '#c9a84c' },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 111,
    updatedAt: 111,
  };
}

async function plantV35(rows: {
  settings?: Record<string, unknown>;
  personas?: Record<string, unknown>[];
  chats?: Record<string, unknown>[];
  trash?: Record<string, unknown>[];
}): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  db.version(35).stores(V35_MIN_STORES);
  await db.open();
  await db
    .table('mindspaces')
    .bulkAdd(LEGACY_BUILTINS.map((b) => legacyMindspace(b.oldId, b.displayName)));
  if (rows.settings) await db.table('settings').add(rows.settings);
  if (rows.personas) await db.table('personas').bulkAdd(rows.personas);
  if (rows.chats) await db.table('chats').bulkAdd(rows.chats);
  if (rows.trash) await db.table('trash').bulkAdd(rows.trash);
  db.close();
}

describe('client-data-db v36 (built-in mindspace ids → deterministic slugs)', () => {
  beforeEach(async () => await _resetClientDataDbForTests());
  afterEach(async () => await _resetClientDataDbForTests());

  it('opens at verno 36 on a fresh install and seeds slug ids', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(36);
    const ids = (await db.mindspaces.toArray()).map((m) => m.id).sort();
    expect(ids).toEqual(SLUGS);
  });

  it('rekeys legacy uuid built-ins to slugs, preserving texture and createdAt', async () => {
    await plantV35({});
    // Give one row a non-default texture to prove preservation.
    const raw = new Dexie('chatsundere_client_data');
    raw.version(35).stores(V35_MIN_STORES);
    await raw.open();
    await raw.table('mindspaces').update('uuid-aurum', { texture: 'aurora' });
    raw.close();

    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    expect(db.verno).toBe(36);

    const all = (await db.mindspaces.toArray()) as MindspaceRow[];
    expect(all.map((m) => m.id).sort()).toEqual(SLUGS);
    const aurum = await db.mindspaces.get('mindspace-builtin-aurum');
    expect(aurum?.texture).toBe('aurora');
    expect(aurum?.createdAt).toBe(111);
    expect(await db.mindspaces.get('uuid-aurum')).toBeUndefined();
  });

  it('remaps settings.defaultMindspaceId, personas.mindspaceId and chats.resolvedMindspaceId', async () => {
    await plantV35({
      settings: { id: 1, defaultMindspaceId: 'uuid-aurum', createdAt: 1, updatedAt: 1 },
      personas: [
        { id: 'p-mapped', providerId: 'prov', mindspaceId: 'uuid-verdan' },
        { id: 'p-null', providerId: 'prov', mindspaceId: null },
        { id: 'p-ghost', providerId: 'prov', mindspaceId: 'ghost-id' },
      ],
      chats: [
        { id: 'c-mapped', personaId: 'p-mapped', resolvedMindspaceId: 'uuid-crimson' },
        { id: 'c-ghost', personaId: 'p-mapped', resolvedMindspaceId: 'ghost-id' },
      ],
    });
    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();

    expect((await db.settings.get(1))?.defaultMindspaceId).toBe('mindspace-builtin-aurum');
    expect((await db.personas.get('p-mapped'))?.mindspaceId).toBe('mindspace-builtin-verdan');
    expect((await db.personas.get('p-null'))?.mindspaceId).toBeNull();
    // Unknown references (historic imports) pass through untouched.
    expect((await db.personas.get('p-ghost'))?.mindspaceId).toBe('ghost-id');
    expect((await db.chats.get('c-mapped'))?.resolvedMindspaceId).toBe(
      'mindspace-builtin-crimson',
    );
    expect((await db.chats.get('c-ghost'))?.resolvedMindspaceId).toBe('ghost-id');
  });

  it('remaps mindspace references inside trash row snapshots', async () => {
    await plantV35({
      trash: [
        {
          id: 'trash-persona',
          collection: 'personas',
          key: 'p-dead',
          row: { id: 'p-dead', mindspaceId: 'uuid-rosari' },
          deletedAt: 1,
          purgeAt: 2,
          entityKind: 'persona',
          rootGroup: 'persona:p-dead',
          parentRef: null,
        },
        {
          id: 'trash-chat',
          collection: 'chats',
          key: 'c-dead',
          row: { id: 'c-dead', personaId: 'p-dead', resolvedMindspaceId: 'uuid-azuro' },
          deletedAt: 1,
          purgeAt: 2,
          entityKind: 'chat',
          rootGroup: 'persona:p-dead',
          parentRef: { field: 'personaId', id: 'p-dead' },
        },
        {
          id: 'trash-other',
          collection: 'messages',
          key: 'm-dead',
          row: { id: 'm-dead', chatId: 'c-dead' },
          deletedAt: 1,
          purgeAt: 2,
          entityKind: 'chatChild',
          rootGroup: 'persona:p-dead',
          parentRef: { field: 'chatId', id: 'c-dead' },
        },
      ],
    });
    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();

    const personaSnap = (await db.trash.get('trash-persona'))?.row as Record<string, unknown>;
    expect(personaSnap.mindspaceId).toBe('mindspace-builtin-rosari');
    const chatSnap = (await db.trash.get('trash-chat'))?.row as Record<string, unknown>;
    expect(chatSnap.resolvedMindspaceId).toBe('mindspace-builtin-azuro');
    const otherSnap = (await db.trash.get('trash-other'))?.row as Record<string, unknown>;
    expect(otherSnap).toEqual({ id: 'm-dead', chatId: 'c-dead' });
  });

  it('is idempotent — re-opening a migrated DB changes nothing', async () => {
    await plantV35({
      settings: { id: 1, defaultMindspaceId: 'uuid-aurum', createdAt: 1, updatedAt: 1 },
    });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    const all = await db.mindspaces.toArray();
    expect(all).toHaveLength(7);
    expect(all.map((m) => m.id).sort()).toEqual(SLUGS);
    expect((await db.settings.get(1))?.defaultMindspaceId).toBe('mindspace-builtin-aurum');
  });
});
```

- [ ] **Step 2: Run the new file to verify it fails**

Run: `pnpm -C apps/user-client vitest run tests/boot/client-data-db-v36.test.ts`
Expected: FAIL — `verno` is 35 and legacy rows are not rekeyed.

- [ ] **Step 3: Implement the v36 migration**

In `apps/user-client/src/boot/client-data-db.ts`, directly after the v35 block (which ends at line 1417), add:

```ts
    // Version 36 — built-in mindspace identity: built-ins move from per-device
    // uuidv7 ids to the deterministic slugs in BUILT_IN_MINDSPACES, so the synced
    // reference fields converge across devices (pre-test-analysis #5; the v35
    // provider-identity pattern). Rekey the seeded rows and remap every
    // referencing store in the same transaction: settings.defaultMindspaceId,
    // personas.mindspaceId, chats.resolvedMindspaceId, and the row snapshots
    // inside trash entries for personas/chats (a trashcan restore must not
    // resurrect a dead uuid reference). Unknown ids (historic imports) pass
    // through untouched. Idempotent: slug-keyed rows are left alone. Stores are
    // unchanged; the bump exists only to run this data rewrite.
    this.version(36)
      .stores({ mindspaces: 'id, builtIn, displayName' })
      .upgrade(async (tx) => {
        const slugByName = new Map(BUILT_IN_MINDSPACES.map((b) => [b.displayName, b.id]));
        const table = tx.table('mindspaces');
        const rows = (await table.toArray()) as MindspaceRow[];
        const oldIdToSlug = new Map<string, string>();
        for (const r of rows) {
          if (r.builtIn !== true) continue;
          const slug = slugByName.get(r.displayName);
          if (slug === undefined || r.id === slug) continue;
          oldIdToSlug.set(r.id, slug);
          await table.delete(r.id);
          await table.put({ ...r, id: slug });
        }
        if (oldIdToSlug.size === 0) return;
        const remap = (id: unknown): string | null =>
          typeof id === 'string' ? (oldIdToSlug.get(id) ?? null) : null;
        await tx
          .table('settings')
          .toCollection()
          .modify((s: Record<string, unknown>) => {
            const mapped = remap(s.defaultMindspaceId);
            if (mapped !== null) s.defaultMindspaceId = mapped;
          });
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            const mapped = remap(p.mindspaceId);
            if (mapped !== null) p.mindspaceId = mapped;
          });
        await tx
          .table('chats')
          .toCollection()
          .modify((c: Record<string, unknown>) => {
            const mapped = remap(c.resolvedMindspaceId);
            if (mapped !== null) c.resolvedMindspaceId = mapped;
          });
        await tx
          .table('trash')
          .toCollection()
          .modify((t: Record<string, unknown>) => {
            if (t.collection !== 'personas' && t.collection !== 'chats') return;
            const snapshot = t.row;
            if (typeof snapshot !== 'object' || snapshot === null) return;
            const snap = snapshot as Record<string, unknown>;
            const mappedPersona = remap(snap.mindspaceId);
            if (mappedPersona !== null) snap.mindspaceId = mappedPersona;
            const mappedChat = remap(snap.resolvedMindspaceId);
            if (mappedChat !== null) snap.resolvedMindspaceId = mappedChat;
          });
      });
```

Note: `BUILT_IN_MINDSPACES` is declared near the bottom of the file (after the class). That is fine — the `.upgrade` callback only runs at open time, long after module evaluation. Do not move the constant.

- [ ] **Step 4: Run the new file to verify it passes**

Run: `pnpm -C apps/user-client vitest run tests/boot/client-data-db-v36.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Sweep the hard-coded verno assertions 35 → 36**

Every file in this task's **Files** sweep list asserts `verno).toBe(35)`. Update all of them in one stroke:

```bash
cd apps/user-client
rg -l 'verno\)\.toBe\(35\)' tests | xargs sed -i 's/verno)\.toBe(35)/verno).toBe(36)/g'
rg -n 'verno\)\.toBe\(35\)' tests
```

Expected: the final `rg` prints nothing (35 assertions across 22 files rewritten). Sanity-check the diff only touches `.toBe(35)` → `.toBe(36)`: `git diff --stat -- tests` should list exactly the 22 files from the sweep list (`tests/unit/client-data-db.test.ts` was already modified in Task 1 — its two verno lines change here too).

- [ ] **Step 6: Run the full user-client suite**

Run: `pnpm -C apps/user-client test`
Expected: green apart from the known 8-failure Node-localStorage baseline (exactly 8; a 9th failure is real — investigate before proceeding).

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck --force` — expect 14/14.

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests
git commit -m "Add Dexie v36 migration rekeying built-in mindspaces to slug ids

Rekeys the seven seeded built-ins from per-device uuids to the
deterministic slugs and remaps settings.defaultMindspaceId,
personas.mindspaceId, chats.resolvedMindspaceId and trash snapshots in
the same transaction. Includes the verno 35 -> 36 assertion sweep.

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Refresh the sync-exclusion rationale comments

The three built-in exclusions in the sync engine **stay** (spec §5) — but their comments justify the exclusion with "uuids are per-device", which stops being true after v36. Comment-only change; no behaviour, no new tests (the existing `tests/sync/builtin-mindspaces.test.ts` pins the behaviour and is id-agnostic).

**Files:**
- Modify: `apps/user-client/src/sync/backfill.ts:32,107`
- Modify: `apps/user-client/src/sync/apply.ts:577-579`
- Modify: `apps/user-client/src/sync/recovery.ts:427-428`

**Interfaces:** none (comments only).

- [ ] **Step 1: Update the four comment sites**

In `apps/user-client/src/sync/backfill.ts` line 32, replace

```
 *    for `mindspaces` never a built-in (its uuid is per-device, §12.5).
```

with:

```
 *    for `mindspaces` never a built-in (deterministically seeded on every
 *    device — syncing them would be redundant, §12.5).
```

In `backfill.ts` lines 106-108, replace

```
 * built-in mindspaces are excluded (their per-device uuids must not sync,
 * §12.5). Everything else derives its key from the row via `syncKeyOfRow`.
```

with:

```
 * built-in mindspaces are excluded (deterministically seeded on every device —
 * syncing them would be redundant, §12.5). Everything else derives its key
 * from the row via `syncKeyOfRow`.
```

In `apps/user-client/src/sync/apply.ts` lines 577-579, replace

```
  // Built-in mindspaces never sync (engine spec §12.5, apply side): a sealed
  // built-in from another device (or a pre-fix recovery) is inert — its uuid is
  // device-local by construction and applying it would duplicate the seeded seven.
```

with:

```
  // Built-in mindspaces never sync (engine spec §12.5, apply side): a sealed
  // built-in from another device (or a pre-v36 recovery) is inert — every device
  // seeds the same slug-keyed seven, so applying one is redundant at best and,
  // from a pre-v36 writer, would resurrect a dead per-device uuid row.
```

In `apps/user-client/src/sync/recovery.ts` lines 427-428, replace

```
      // Built-in mindspaces never sync (engine spec §12.5): their uuids are minted
      // per device, so pushing them seeds cross-device duplicates.
```

with:

```
      // Built-in mindspaces never sync (engine spec §12.5): every device seeds
      // the same slug-keyed seven, so pushing them is redundant.
```

- [ ] **Step 2: Verify the sync tests still pass**

Run: `pnpm -C apps/user-client vitest run tests/sync/builtin-mindspaces.test.ts tests/sync/backfill.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/user-client/src/sync/backfill.ts apps/user-client/src/sync/apply.ts apps/user-client/src/sync/recovery.ts
git commit -m "Refresh built-in mindspace sync-exclusion rationale for slug ids [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Documentation — analysis addendum and follow-ups ledger

**Files:**
- Modify: `PRE-TEST-ANALYSIS-v0.2.0.md` (new addendum after the 2026-07-07 one at line 46)
- Modify: `obsidian/insights/follow-ups-index.md:66` (the finding-#5 row)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add the fix addendum to the analysis**

In `PRE-TEST-ANALYSIS-v0.2.0.md`, after the "Addendum 2026-07-07 — findings #8 and #9 fixed" section (its test-plan-impact paragraph ends at line 46), insert:

```markdown
## Addendum 2026-07-07 (later) — finding #5 fixed (this branch)

- **#5 fixed.** Built-in mindspaces now carry deterministic slug ids
  (`mindspace-builtin-<name>`, defined once in `BUILT_IN_MINDSPACES`); a Dexie v36
  migration rekeys the seeded rows and remaps every reference in the same
  transaction — `settings.defaultMindspaceId`, `personas.mindspaceId`,
  `chats.resolvedMindspaceId` (a third synced reference field the original finding
  missed: every synced chat rendered with the fallback palette on other devices),
  and trash row snapshots. Built-ins stay excluded from sync; convergence follows
  from identical seeding. No republish choreography — same load-bearing assumption
  as the provider fix (no real account has pre-migration ciphertext; v0.1.3 is
  local-only, dev sync state is reset before go-live). Spec:
  [`superpowers/specs/2026-07-07-builtin-mindspace-deterministic-ids-design.md`](superpowers/specs/2026-07-07-builtin-mindspace-deterministic-ids-design.md).

Test plan impact: step 7's second leg now has a *fixed* expectation — device B
shows device A's chosen default/persona mindspace after sync (and synced chats
render with their original palette) instead of the silent fallback.
```

Also update the "Still open" line in the 2026-07-07 addendum (line 44) from `#5 (mindspace convergence — dedicated session), #7 …` to `#7 …` (drop the #5 entry, keep the rest verbatim), and in line 184 (test-plan step 7) replace `(expect the silent fallback — finding #5)` with `(expect convergence — finding #5 fixed)`.

- [ ] **Step 2: Resolve the follow-ups-index row**

In `obsidian/insights/follow-ups-index.md`, replace the table row at line 66 (starts `| Built-in mindspace ids diverge per device`) following the file's in-place strikethrough convention (see the resolved analysis-#8 row directly below it as the model). New row content:

```markdown
| ~~Built-in mindspace ids diverge per device → `settings.defaultMindspaceId` / `persona.mindspaceId` dangle cross-device, silent fallback to `mindspaces[0]` (2026-07-06, analysis #5)~~ | **RESOLVED 2026-07-07** (this branch) | Deterministic slug ids (`mindspace-builtin-<name>`) via the provider-fix pattern: Dexie v36 rekeys the seeded seven and remaps `settings.defaultMindspaceId`, `personas.mindspaceId`, `chats.resolvedMindspaceId` (a third synced reference the finding missed) and trash snapshots in one transaction. Built-ins stay sync-excluded; convergence follows from identical seeding. Spec: [[../../superpowers/specs/2026-07-07-builtin-mindspace-deterministic-ids-design]]. Source: [[../../PRE-TEST-ANALYSIS-v0.2.0]] Q4 |
```

- [ ] **Step 3: Commit**

```bash
git add PRE-TEST-ANALYSIS-v0.2.0.md obsidian/insights/follow-ups-index.md
git commit -m "Record mindspace-convergence fix in the pre-test analysis and follow-ups ledger [skip ci]

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Final verification + hand-off (whole branch)

**Files:** none (verification and reporting only).

- [ ] **Step 1: Run the full gates on the branch tip**

- `pnpm typecheck --force` — expect 14/14.
- `pnpm -C apps/user-client test` — full suite; green apart from the known 8-failure Node-localStorage baseline (exactly the files recorded in Step 0 — see operating rule 3).
- `pnpm run build` — expect 9/9.
- `rg -n 'verno\)\.toBe\(35\)' apps/user-client/tests` — prints nothing.
- `rg -n "uuidv7" apps/user-client/src/boot/client-data-db.ts` — no `uuidv7(` call and no import remain (comment mentions are fine).

- [ ] **Step 2: Hand-off report — then STOP**

Do NOT merge, do NOT push to `master`, do NOT squash — the human device-tests first
and the controller squashes at integration. Report back:

1. The branch name and the full commit list (`git log --oneline master..HEAD`).
2. Every verification number from Step 1, including the exact baseline-failure file
   names and count (must be the Step-0 set).
3. Any deviation from the plan (there should be none) and any task stopped under
   operating rule 11.

## Deliberately out of scope

- **No sync-engine behaviour change** — the three built-in exclusions stay (spec §5).
- **No post-migration republish** — conscious, documented assumption (spec §5); the fallback if it ever proves false is a one-shot enqueue of the remapped rows.
- **No resolver change** — `resolveMindspace`'s `mindspaces[0]` fallback stays; slug ordering happens to make it Aurum.
- **STATUS-BACKEND update** — done by Liz at integration time, not on this branch (avoids collisions with parallel sessions).

## Post-run (Liz + Chris, not the worker)

1. Larissa audits the built diff (identity-derived ids + sync-convergence semantics — the v35 precedent).
2. Chris reviews, merges, and runs the manual verification (spec §8: existing-device upgrade, convergence, chat palette, trash restore).
3. Liz updates STATUS-BACKEND and squashes per the one-feature-unit convention.
