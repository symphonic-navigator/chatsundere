# MCP "Local network" routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-server, opt-in "Local network" toggle that lets the user-client connect to an MCP server directly (CORS-required) instead of via the CORS proxy; off by default.

**Architecture:** A new intent field `allowDirect: boolean` on `McpServerRow` (separate from the existing test-outcome `routing` field) gates the direct probe candidates in `buildCandidates()`. OFF (default) probes proxy-only; ON restores the existing direct-first / proxy-fallback order. A Dexie v30 migration backfills `allowDirect` from each row's current `routing`. The sheet gains a toggle that resets the server to untested on change.

**Tech Stack:** TypeScript (strict), React 18, Dexie (IndexedDB), Vitest, Tailwind v4, Biome.

**Spec:** `superpowers/specs/2026-06-25-mcp-local-network-routing-design.md`

## Global Constraints

- British English in every artefact (code, comments, copy, commit messages). No mixed-language strings.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline justification comment.
- No `!` non-null assertions (Biome bans them; pre-commit runs Biome only).
- SPDX header `// SPDX-License-Identifier: AGPL-3.0-only` on every new source file (matches sibling files).
- Gate before squash: `pnpm typecheck --force` (Turbo caches test-only typechecks) **and** `pnpm --filter @chatsundere/user-client test` green, run by Liz — not a subagent's word.
- Client-only change. Do NOT touch `apps/auth-service`, `sync-service`, `proxy-service`, `packages/crypto`.
- Commands run from `apps/user-client/` unless stated. Subagents never merge, push, or switch branches.

---

### Task 1: Data model + Dexie v30 migration

Add the `allowDirect` intent field, the migration that backfills it, and update the schema-version test assertions.

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts` — `McpServerRow` interface (around line 87-107) and the version chain (after `this.version(29)` ending line 1012).
- Create: `apps/user-client/tests/boot/client-data-db-v30.test.ts`
- Modify (sweep): every test asserting `expect(db.verno).toBe(29)` / `expect(getClientDataDb().verno).toBe(29)` → `30`. As of writing these live in (verify by search, do not trust this list blindly): `tests/boot/client-data-db-v7.test.ts`, `-v9`, `-v21`, `-v22`, `-v23`, `-v24`, `-v27`, `-v29`, `client-data-db.imagegen.test.ts`, `client-data-db.webinterfacing.test.ts`, `knowledge-schema.test.ts`, `tests/unit/client-data-db.test.ts`, `tests/unit/expert-web-migration.test.ts`, `tests/unit/artefacts-schema.test.ts`, `tests/unit/attachments-schema.test.ts`, `tests/unit/roleplay-schema.test.tsx`.

**Interfaces:**
- Produces: `McpServerRow.allowDirect: boolean` (new required field). Dexie head version becomes `30`.

- [ ] **Step 1: Add the field to the interface**

In `client-data-db.ts`, add `allowDirect` to `McpServerRow` immediately above `routing`:

```typescript
  enabled: boolean;
  /** User intent: may this server be reached directly (CORS required)? Off → proxy-only. */
  allowDirect: boolean;
  routing: 'direct' | 'proxy' | null;
```

- [ ] **Step 2: Add the v30 migration**

Insert directly after the `this.version(29)…` block (the one closing at line 1012, before the closing `}` of the constructor). Mirror the v25/v26 pattern (upgrade-only, no `.stores()` — `allowDirect` is non-indexed so no schema change is needed):

```typescript
    // Version 30 — MCP local-network routing. mcpServers gain `allowDirect`
    // (user intent; off → proxy-only). Backfilled from the row's resolved
    // `routing`: a server already resolved to direct keeps working.
    this.version(30).upgrade(async (tx) => {
      await tx
        .table('mcpServers')
        .toCollection()
        .modify((s: Record<string, unknown>) => {
          if (typeof s.allowDirect !== 'boolean') s.allowDirect = s.routing === 'direct';
        });
    });
```

- [ ] **Step 3: Write the migration test**

Create `tests/boot/client-data-db-v30.test.ts`. The first test pins the head version; the second proves the backfill by seeding a pre-v30 `mcpServers` row via a raw Dexie handle is overkill — instead assert the fresh-install default and the backfill mapping through a direct `modify` is not reachable, so test the head + that a freshly put row round-trips `allowDirect`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

describe('client-data-db v30 — MCP local-network routing', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at version 30 on a fresh install', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    expect(db.verno).toBe(30);
  });

  it('round-trips an mcpServers row carrying allowDirect', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.mcpServers.put({
      id: 'srv-1',
      name: 'LAN tools',
      url: 'http://192.168.1.50:9000',
      prefix: 'lan',
      auth: null,
      onByDefault: false,
      autoRun: false,
      enabled: true,
      allowDirect: true,
      routing: null,
      resolvedEndpoint: null,
      tools: [],
      hiddenTools: [],
      lastTestedAt: null,
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const back = await db.mcpServers.get('srv-1');
    expect(back?.allowDirect).toBe(true);
  });
});
```

- [ ] **Step 4: Run the new test, expect FAIL then PASS**

Run: `pnpm vitest run tests/boot/client-data-db-v30.test.ts`
Expected first: FAIL on `toBe(30)` (head still 29) — confirms the version bump is real. After Steps 1-2 are in place it should PASS. If it passed before you added the migration, the bump didn't take effect — investigate.

- [ ] **Step 5: Sweep the stale version assertions**

Find every remaining `toBe(29)` tied to `db.verno` / `getClientDataDb().verno` and bump to `30`. Search first:

Run: `rg -rn --fixed-strings "verno).toBe(29)" tests src`

Update each hit to `toBe(30)`. Do NOT blanket-replace every `toBe(29)` in the tree — only those asserting the DB head version (the `verno` ones). Leave unrelated `29`s alone.

- [ ] **Step 6: Run the full user-client suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: green except the known Node-localStorage baseline (exactly 8 failures from the experimental-localStorage trio; a 9th is real). If a `verno`/`toBe(29)` assertion still fails, you missed one in Step 5.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/tests
git commit -m "Add allowDirect intent field and Dexie v30 migration for MCP local-network routing"
```

---

### Task 2: Gate direct probe candidates on `allowDirect`

Make `buildCandidates()` and `testMcpConnection()` honour the intent: OFF → proxy-only, ON → direct-first then proxy.

**Files:**
- Modify: `apps/user-client/src/mcp/mcp-connectivity.ts` — `buildCandidates` (line 12-17) and `testMcpConnection` (line 62-73).
- Test: `apps/user-client/tests/` — extend the existing connectivity test if one exists (`rg -l buildCandidates tests`), else create `apps/user-client/tests/mcp/mcp-connectivity.test.ts`.

**Interfaces:**
- Consumes: nothing from Task 1 (operates on a plain boolean).
- Produces: `buildCandidates(url: string, hasProxy: boolean, allowDirect: boolean): McpCandidate[]` and `testMcpConnection(input: { url; hasProxy; allowDirect; corsProxy; auth })`. Task 3 calls `testMcpConnection` with the new `allowDirect` field.

- [ ] **Step 1: Write the failing test**

Create/extend the connectivity test:

```typescript
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildCandidates } from '../../src/mcp/mcp-connectivity.js';

describe('buildCandidates — allowDirect gating', () => {
  it('proxy-only when allowDirect is false (proxy configured)', () => {
    const c = buildCandidates('http://192.168.1.50:9000', true, false);
    expect(c.every((x) => x.routing === 'proxy')).toBe(true);
    expect(c.some((x) => x.routing === 'direct')).toBe(false);
  });

  it('empty when allowDirect is false and no proxy', () => {
    expect(buildCandidates('http://192.168.1.50:9000', false, false)).toEqual([]);
  });

  it('direct-first then proxy when allowDirect is true (proxy configured)', () => {
    const c = buildCandidates('http://192.168.1.50:9000', true, true);
    expect(c[0]?.routing).toBe('direct');
    expect(c.some((x) => x.routing === 'proxy')).toBe(true);
  });

  it('direct-only when allowDirect is true and no proxy', () => {
    const c = buildCandidates('http://192.168.1.50:9000', false, true);
    expect(c.every((x) => x.routing === 'direct')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mcp/mcp-connectivity.test.ts`
Expected: FAIL — `buildCandidates` currently takes 2 args; the 3-arg calls and the proxy-only expectation fail (TS arity error or wrong routings).

- [ ] **Step 3: Update `buildCandidates`**

Replace the body (line 12-17):

```typescript
/**
 * Build the ordered probe candidates. `allowDirect` is the user's intent:
 * when false, only proxy candidates are produced (the client never probes the
 * network directly); when true, direct is tried first, then proxy as fallback.
 */
export function buildCandidates(
  url: string,
  hasProxy: boolean,
  allowDirect: boolean,
): McpCandidate[] {
  const trimmed = url.replace(/\/+$/, '');
  const variants = trimmed.endsWith('/mcp') ? [trimmed] : [trimmed, `${trimmed}/mcp`];
  const routings: McpRouting[] = allowDirect
    ? hasProxy
      ? ['direct', 'proxy']
      : ['direct']
    : hasProxy
      ? ['proxy']
      : [];
  return routings.flatMap((routing) => variants.map((u) => ({ routing, url: u })));
}
```

- [ ] **Step 4: Thread `allowDirect` through `testMcpConnection`**

Replace `testMcpConnection` (line 62-73):

```typescript
/** Top-level entry the UI calls. */
export async function testMcpConnection(input: {
  url: string;
  hasProxy: boolean;
  allowDirect: boolean;
  corsProxy: { url: string; key: string } | null;
  auth: McpAuthResolved | null;
}): Promise<McpConnectionResult> {
  return resolveConnection(
    buildCandidates(input.url, input.hasProxy, input.allowDirect),
    liveProbe(input.corsProxy, input.auth),
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/mcp/mcp-connectivity.test.ts`
Expected: PASS (4/4 in the new describe block; any pre-existing tests in the file stay green).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/mcp/mcp-connectivity.ts apps/user-client/tests/mcp
git commit -m "Gate MCP direct probe candidates on the allowDirect intent"
```

---

### Task 3: "Local network" toggle in the server sheet

Wire the toggle into `McpServerSheet`: state, reset-to-untested on change, pass `allowDirect` to the test, persist it on save, and a constructive error when proxy-less + direct-off.

**Files:**
- Modify: `apps/user-client/src/components/mcp/McpServerSheet.tsx` — state block (~line 44-55), `onTest` (line 87-130), `onSave` row literal (line 171-188), toggle JSX (after the `autoRun` label, line 379).

**Interfaces:**
- Consumes: `McpServerRow.allowDirect` (Task 1); `testMcpConnection({ …, allowDirect })` (Task 2).

- [ ] **Step 1: Add toggle state**

After the `autoRun` state line (line 45), add:

```typescript
  const [allowDirect, setAllowDirect] = useState(existing?.allowDirect ?? false);
```

- [ ] **Step 2: Reset-to-untested handler**

Flipping the toggle invalidates the prior test outcome (the route may change). Add this handler near the other handlers (e.g. above `toggleHidden`, line 132):

```typescript
  function onToggleAllowDirect() {
    setAllowDirect((v) => !v);
    // The resolved route is no longer trustworthy once intent changes — force a re-test.
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
    setLastError(null);
    setLastTestedAt(null);
    setTest({ kind: 'idle' });
  }
```

- [ ] **Step 3: Constructive guard + pass `allowDirect` in `onTest`**

In `onTest`, after the `hasProxy` line (line 98) add a constructive early return, and pass `allowDirect` into the call (line 118):

```typescript
      const hasProxy = settings.data?.corsProxy != null;
      if (!allowDirect && !hasProxy) {
        setLastError(
          'No CORS proxy configured. Turn on Local network to connect directly, or add a proxy in AI provider settings.',
        );
        setTest({ kind: 'done' });
        return;
      }
```

```typescript
      const result = await testMcpConnection({ url, hasProxy, allowDirect, corsProxy, auth });
```

- [ ] **Step 4: Persist `allowDirect` on save**

In the `row` literal in `onSave` (line 171-188), add `allowDirect` next to `autoRun`:

```typescript
        onByDefault,
        autoRun,
        allowDirect,
        enabled: true,
```

- [ ] **Step 5: Add the toggle JSX**

After the `autoRun` label block (closing `</label>` at line 379), insert:

```tsx
          <label className="flex items-center gap-2 text-xs text-paper-soft">
            <input
              type="checkbox"
              checked={allowDirect}
              onChange={onToggleAllowDirect}
              aria-label="Local network — connect directly (must support CORS)"
            />
            Local network <span className="text-paper-soft/60">(must support CORS)</span>
          </label>
```

- [ ] **Step 6: Typecheck (catches any other McpServerRow literal missing the field)**

Run (from repo root): `pnpm typecheck --force`
Expected: PASS. If a test fixture or seed builds an `McpServerRow` literal, tsc flags the missing `allowDirect` — add `allowDirect: false` there. Fix every such site before continuing.

- [ ] **Step 7: Run the full user-client suite**

Run: `pnpm --filter @chatsundere/user-client test`
Expected: green except the known 8 Node-localStorage baseline failures.

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/components/mcp/McpServerSheet.tsx
git commit -m "Add Local network toggle to the MCP server sheet"
```

---

## Post-implementation (Liz, not a subagent)

- [ ] `pnpm typecheck --force` and `pnpm --filter @chatsundere/user-client test` both green from the repo root.
- [ ] Laura (UX) pre-squash pass — new user-reachable control; check the constructive-error path (proxy-less + direct-off) and that the status line confirms the resolved route.
- [ ] Larissa optional (security flavour, though path gate does not trigger — client-only).
- [ ] Manual verification per the spec's checklist on device.
- [ ] Squash the three task commits into one feature commit; verify `git diff --cached --name-only` carries no scratch/report pollution; update `obsidian/STATUS-CLIENT-ONLY.md`.

## Self-review notes

- Spec coverage: §Data model → Task 1; §Behaviour change → Task 2; §UI + §constructive "Needs proxy" → Task 3; §Testing (buildCandidates, migration, verno sweep) → Tasks 1-2; §Security is advisory (post-impl checklist).
- Type consistency: `allowDirect: boolean` used identically in interface (T1), `testMcpConnection` input (T2), sheet state + row literal (T3); `buildCandidates` 3-arg signature consistent T2↔T3.
- The migration backfills via `s.routing === 'direct'`, matching the spec's mapping exactly.
