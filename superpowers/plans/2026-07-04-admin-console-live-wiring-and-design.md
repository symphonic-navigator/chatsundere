# Admin Console Live Wiring + Control-Panel Design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `superpowers/specs/2026-07-04-admin-console-live-wiring-and-design.md` — read it first; it is the contract this plan implements.

**Goal:** Replace the admin-client's mock data layer with live auth-service wiring (including two server-side fixes and audit enrichment), land change-role / transfer-primary / invitation-field functionality, then restyle the console as a Catppuccin-Mocha retrofuturistic control panel.

**Architecture:** Two feature units in strict order. Unit 1 (Tasks 1–13) makes `packages/shared-types/src/admin.ts` the single wire truth, enriches/fixes two auth-service admin endpoints, replaces the `AdminApi` class zoo with one module of typed fetch functions, migrates each screen, and deletes the mock layer. Unit 2 (Tasks 14–19) adds bundled fonts, a Mocha-only token set, a small component kit, and restyles every screen. Unit boundaries matter: the security-relevant diff (Unit 1) must not be diluted by styling noise.

**Tech Stack:** TypeScript strict, Hono + Drizzle + Bun tests (auth-service), React 18 + TanStack Query + Vitest (admin-client), Tailwind v4 CSS-first, Fontsource.

## Global Constraints

- Every text artefact is **British English** (code, comments, copy strings, commit messages, ADRs).
- Every new source file starts with the correct SPDX header: `// SPDX-License-Identifier: AGPL-3.0-only` under `apps/`, `// SPDX-License-Identifier: MIT` in `packages/shared-types`.
- Biome is the pre-commit gate and **bans the non-null assertion `!`** — never use it; narrow with checks instead.
- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`; no `any` without an inline justification comment.
- Tests live under each app's `tests/` tree (`tests/unit/`, `tests/integration/`), never beside sources.
- auth-service tests run with Bun (`bun test`), admin-client tests with Vitest (`pnpm test` inside `apps/admin-client/`).
- The auth-service integration tests skip without `DATABASE_URL`/`REDIS_URL`; run them with the dev env loaded: `cd apps/auth-service && bun test --env-file=../../.env.dev` (verify the env file name via `ls ../../.env*` — `dev.sh` loads `.env.dev`).
- Before any commit that touched types or cross-package imports: `pnpm typecheck --force` at the repo root must report **14 successful, 14 total**.
- New dependencies allowed in this plan: `@fontsource/space-grotesk`, `@fontsource/jetbrains-mono` (admin-client only). Nothing else.
- Comments explain non-obvious *why*, never *what*. No emoji anywhere in the repo.
- Commit per task, free-form imperative subject, no Conventional-Commits prefix, each ending with:
  `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
- **Never merge, push, or switch branches.** Work on the branch the harness put you on (branched from `full-backend-transition`).

---

## Unit 1 — Wire admin-client to live backend (Tasks 1–13)

### Task 1: Correct and extend the admin wire types in shared-types

**Files:**
- Modify: `packages/shared-types/src/admin.ts`
- Verify: `packages/shared-types/src/index.ts:63` already re-exports `./admin.js`

**Interfaces:**
- Produces: `AdminAuditLogEntry` (+`user_username`, `actor_username`), `AdminCreateInvitationRequest` (+`suggested_username`, `note`), `AdminCreateInvitationResponse` (corrected to server truth), `AdminInvitationStatus`, `AdminInvitationSummary`, `AdminInvitationListResponse`, `AdminChangeRoleRequest`, `AdminTransferPrimaryRequest`. All later tasks import these from `@chatsundere/shared-types`.

- [ ] **Step 1: Rewrite the drifted/missing types**

In `packages/shared-types/src/admin.ts`:

Add to `AdminAuditLogEntry` (after `actor_user_id`):

```ts
  /** Username of user_id at query time; null when the user is deleted. */
  user_username: string | null;
  /** Username of actor_user_id at query time; null when the actor is deleted. */
  actor_username: string | null;
```

Extend `AdminCreateInvitationRequest`:

```ts
export interface AdminCreateInvitationRequest {
  role: 'admin' | 'user';
  expires_in_seconds: number;
  issuer_label?: string;
  suggested_username?: string;
  note?: string;
}
```

Replace `AdminCreateInvitationResponse` (the old `token`/`qr_payload` shape never matched the server — see `apps/auth-service/src/routes/admin/invitations.ts:119-128`):

```ts
export interface AdminCreateInvitationResponse {
  invitation_id: string;
  /** The one-time 10-character join code. Never returned again after this response. */
  code: string;
  /** Deep-link URL embedding the code as a fragment; QR-encodable as-is. */
  qr_url: string;
  expires_at: string;
  state: 'active';
}
```

Append the list types (matching `apps/auth-service/src/routes/admin/invitations.ts:54-71` verbatim) and the two action request bodies:

```ts
export type AdminInvitationStatus = 'pending' | 'redeemed' | 'revoked' | 'expired';

export interface AdminInvitationSummary {
  id: string;
  role: 'admin' | 'user' | 'primary_admin';
  issuer_label: string | null;
  suggested_username: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  revoked_at: string | null;
  attempt_count: number;
  status: AdminInvitationStatus;
}

export interface AdminInvitationListResponse {
  invitations: AdminInvitationSummary[];
  total: number;
}

export interface AdminChangeRoleRequest {
  role: 'admin' | 'user';
}

export interface AdminTransferPrimaryRequest {
  target_user_id: string;
}
```

- [ ] **Step 2: Typecheck**

Run at repo root: `pnpm typecheck --force`
Expected: **14 successful, 14 total** (nothing imports the changed invitation-response type yet — the admin-client still uses its local types).

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/admin.ts
git commit -m "Align admin wire types in shared-types with the auth-service responses"
```

---

### Task 2: Audit-log endpoint — usernames + newest-first ordering (auth-service)

**Files:**
- Modify: `apps/auth-service/src/routes/admin/audit.ts`
- Create: `apps/auth-service/tests/integration/admin-audit-log.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/admin/audit-log` entries gain `user_username: string | null` and `actor_username: string | null`; ordering becomes `created_at DESC`. Filters, pagination, and the `{ entries, total }` envelope are unchanged. Task 5's `listAudit` relies on exactly this shape.

- [ ] **Step 1: Write the failing integration test**

Create `apps/auth-service/tests/integration/admin-audit-log.test.ts`. Copy the `registerUser` and `cleanupUser` helpers **verbatim** from `apps/auth-service/tests/integration/admin-users.test.ts:21-95` (they are file-local there), then add:

```ts
describe.skipIf(skip)('Admin audit-log endpoint', () => {
  let app: ReturnType<typeof createServer>;
  let adminId: string;
  let subjectId: string;
  let adminToken: string;

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
    ({ userId: adminId } = await registerUser(app, {
      password: 'audit-admin-pass-1',
      username: `audit-admin-${Date.now()}`,
      role: 'admin',
    }));
    ({ userId: subjectId } = await registerUser(app, {
      password: 'audit-subject-pass-1',
      username: `audit-subject-${Date.now()}`,
      role: 'user',
    }));
    // Mirror the token issuance EXACTLY as admin-users.test.ts does it — read
    // its beforeAll for the real issueTokens signature before writing this.
    const tokens = await issueTokens(adminId, 'admin');
    adminToken = tokens.accessToken;

    // Seed two rows with controlled timestamps so ordering is deterministic.
    const { db } = createDb();
    await db.insert(auditLog).values([
      {
        eventType: 'user.suspended',
        userId: subjectId,
        actorUserId: adminId,
        metadata: {},
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
      {
        eventType: 'user.unsuspended',
        userId: subjectId,
        actorUserId: adminId,
        metadata: {},
        createdAt: new Date('2026-01-01T11:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    const { db } = createDb();
    await db.delete(auditLog).where(eq(auditLog.userId, subjectId));
    await cleanupUser(subjectId);
    await cleanupUser(adminId);
    await closeDb();
  });

  it('returns usernames for user_id and actor_user_id', async () => {
    const res = await app.request(`/api/v1/admin/audit-log?user_id=${subjectId}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{ user_username: string | null; actor_username: string | null }>;
    };
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    const first = body.entries[0];
    expect(first?.user_username).toStartWith('audit-subject-');
    expect(first?.actor_username).toStartWith('audit-admin-');
  });

  it('orders newest first', async () => {
    const res = await app.request(`/api/v1/admin/audit-log?user_id=${subjectId}`, {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as { entries: Array<{ created_at: string }> };
    const times = body.entries.map((e) => new Date(e.created_at).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  it('returns null usernames for a deleted user', async () => {
    // Seed a row pointing at a user we then delete.
    const { userId: doomedId } = await registerUser(app, {
      password: 'audit-doomed-pass-1',
      username: `audit-doomed-${Date.now()}`,
      role: 'user',
    });
    const { db } = createDb();
    await db.insert(auditLog).values({
      eventType: 'user.deleted_by_admin',
      userId: null,
      actorUserId: doomedId,
      metadata: {},
    });
    // Capture the row id before deleting the user (actor FK may be SET NULL).
    await cleanupUser(doomedId);
    const res = await app.request('/api/v1/admin/audit-log?event_type=user.deleted_by_admin', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as {
      entries: Array<{ actor_user_id: string | null; actor_username: string | null }>;
    };
    // Whether the FK nulled the id or kept it, the username must be null.
    for (const entry of body.entries) {
      expect(entry.actor_username).toBeNull();
    }
  });
});
```

Adjust the imports at the top of the file to include `auditLog` from `../../src/db/schema.js` (alongside the helper imports copied from `admin-users.test.ts`). Check `apps/auth-service/src/db/schema.ts:137-151` for the FK behaviour of `actor_user_id` before finalising the third test — if the FK cascades on delete, seed the deleted-user case accordingly (the assertion "username is null" holds either way; only the seeding may need to change).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/auth-service && bun test tests/integration/admin-audit-log.test.ts --env-file=../../.env.dev`
Expected: FAIL — `user_username`/`actor_username` are `undefined`, and the ordering test fails (currently ASC).

- [ ] **Step 3: Implement the join + ordering**

In `apps/auth-service/src/routes/admin/audit.ts`, replace the ASC import/usage and the plain select. Use Drizzle's `alias` for the second join:

```ts
import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { auditLog, users } from '../../db/schema.js';
```

Replace the parallel fetch block (`audit.ts:45-54`) with:

```ts
    const actorUsers = alias(users, 'actor_users');
    const [countResult, rows] = await Promise.all([
      db.select({ total: count() }).from(auditLog).where(where),
      db
        .select({
          entry: auditLog,
          userUsername: users.username,
          actorUsername: actorUsers.username,
        })
        .from(auditLog)
        .leftJoin(users, eq(auditLog.userId, users.id))
        .leftJoin(actorUsers, eq(auditLog.actorUserId, actorUsers.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset),
    ]);
```

And the response mapping:

```ts
    return c.json({
      entries: rows.map((r) => ({
        id: r.entry.id,
        user_id: r.entry.userId,
        actor_user_id: r.entry.actorUserId,
        user_username: r.userUsername,
        actor_username: r.actorUsername,
        event_type: r.entry.eventType,
        metadata: r.entry.metadata as Record<string, unknown>,
        created_at: r.entry.createdAt.toISOString(),
      })),
      total,
    });
```

Update the route JSDoc to mention the two username fields and DESC ordering (deliberate change; the endpoint had no consumers).

- [ ] **Step 4: Run the new tests and the full auth-service suite**

Run: `cd apps/auth-service && bun test --env-file=../../.env.dev`
Expected: new file PASSES; no regressions elsewhere (compare failure count against a pre-change run of the same command — do not trust memory of the baseline).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-service/src/routes/admin/audit.ts apps/auth-service/tests/integration/admin-audit-log.test.ts
git commit -m "Enrich admin audit-log entries with usernames and order newest first"
```

---

### Task 3: Users list — real total + role/status filters (auth-service)

**Files:**
- Modify: `apps/auth-service/src/routes/admin/users.ts:20-50`
- Modify: `apps/auth-service/tests/integration/admin-users.test.ts` (append tests)

**Interfaces:**
- Produces: `GET /api/v1/admin/users?q=&role=&status=&limit=&offset=` with a correct filtered `total`. `role` ∈ `user|admin|primary_admin`, `status` ∈ `active|suspended`. Task 5's `listUsers` relies on this.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe.skipIf(skip)('Admin user endpoints', ...)` block in `apps/auth-service/tests/integration/admin-users.test.ts` (it already has a primary_admin, an admin, and a user registered plus an admin token — reuse those fixtures; read the file's beforeAll to pick up the exact variable names before writing):

```ts
  it('returns the filtered total, not the page length', async () => {
    const res = await app.request('/api/v1/admin/users?limit=1', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as { users: unknown[]; total: number };
    expect(body.users.length).toBe(1);
    // At least the three fixture users exist; total must count them all.
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by role', async () => {
    const res = await app.request('/api/v1/admin/users?role=primary_admin', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as { users: Array<{ role: string }>; total: number };
    expect(body.users.every((u) => u.role === 'primary_admin')).toBe(true);
    expect(body.total).toBe(body.users.length <= 20 ? body.users.length : body.total);
  });

  it('filters by suspension status', async () => {
    const res = await app.request('/api/v1/admin/users?status=suspended', {
      headers: { Authorization: `Bearer ${adminToken}`, ...ORIGIN },
    });
    const body = (await res.json()) as {
      users: Array<{ suspended_at: string | null }>;
      total: number;
    };
    expect(body.users.every((u) => u.suspended_at !== null)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/auth-service && bun test tests/integration/admin-users.test.ts --env-file=../../.env.dev`
Expected: the total test FAILS (`total` is 1 — the page length); the role/status tests FAIL with valibot/unfiltered results (params ignored today).

- [ ] **Step 3: Implement**

In `apps/auth-service/src/routes/admin/users.ts`, replace the list handler body (`users.ts:26-50`):

```ts
  app.get('/api/v1/admin/users', bearerAuth({ minRole: 'admin' }), async (c) => {
    const q = c.req.query('q');
    const role = c.req.query('role');
    const status = c.req.query('status');
    const limit = Math.min(100, Number.parseInt(c.req.query('limit') ?? '20', 10) || 20);
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const { db } = createDb();

    const conditions = [];
    if (q) conditions.push(ilike(users.username, `%${q}%`));
    if (role === 'user' || role === 'admin' || role === 'primary_admin') {
      conditions.push(eq(users.role, role));
    }
    if (status === 'suspended') conditions.push(isNotNull(users.suspendedAt));
    if (status === 'active') conditions.push(isNull(users.suspendedAt));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      db.select({ total: count() }).from(users).where(where),
      db.select().from(users).where(where).limit(limit).offset(offset).orderBy(asc(users.username)),
    ]);

    return c.json({
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        role: r.role,
        suspended_at: r.suspendedAt?.toISOString() ?? null,
        created_at: r.createdAt.toISOString(),
        last_login_at: r.lastLoginAt?.toISOString() ?? null,
      })),
      total: countResult[0]?.total ?? 0,
    });
  });
```

Extend the drizzle import at the top of the file: `import { and, asc, count, eq, ilike, isNotNull, isNull, sql } from 'drizzle-orm';` (keep `sql` — transfer-primary uses it). Update the route JSDoc to document `role=` and `status=`.

- [ ] **Step 4: Run the full auth-service suite**

Run: `cd apps/auth-service && bun test --env-file=../../.env.dev`
Expected: all admin-users tests pass; no new failures anywhere.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-service/src/routes/admin/users.ts apps/auth-service/tests/integration/admin-users.test.ts
git commit -m "Fix admin users-list total and add role/status filters"
```

---

### Task 4: Client view-model module (`types.ts`) with derivations

**Files:**
- Create: `apps/admin-client/src/data/types.ts`
- Test: `apps/admin-client/tests/unit/data-types.test.ts`

**Interfaces:**
- Consumes: shared-types from Task 1.
- Produces (imported by Tasks 5–11):

```ts
export type UserStatus = 'active' | 'suspended';
export type AuditEventCategory =
  | 'auth' | 'user-lifecycle' | 'invitation-lifecycle'
  | 'recovery' | 'security' | 'admin-action';
export interface UserRow extends AdminUserSummary { status: UserStatus }
export interface UserDetailView extends AdminUserDetail { status: UserStatus; is_last_primary_admin: boolean }
export interface AuditRow extends AdminAuditLogEntry { category: AuditEventCategory }
export interface Paged<T> { items: T[]; total: number; page: number; per_page: number }
export interface DashboardSummary {
  total_users: number; suspended_users: number; pending_invitations: number;
  soonest_pending_expiry: string | null; events_24h: number; recent_activity: AuditRow[];
}
export interface UserListQuery { search?: string; role?: 'user' | 'admin' | 'primary_admin' | 'all'; status?: UserStatus | 'all'; page?: number; per_page?: number }
export interface InvitationListQuery { status?: AdminInvitationStatus | 'all'; page?: number; per_page?: number }
export interface AuditListQuery { event_type?: string; user_id?: string; from?: string; to?: string; page?: number; per_page?: number }
export interface CreateInvitationInput { role: 'user' | 'admin'; expires_in_days: 1 | 7 | 30; issuer_label?: string; suggested_username?: string; note?: string }
export function deriveCategory(eventType: string): AuditEventCategory
export function deriveStatus(suspendedAt: string | null): UserStatus
export function toExpiresInSeconds(days: 1 | 7 | 30): number
```

- [ ] **Step 1: Write the failing tests**

Create `apps/admin-client/tests/unit/data-types.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  deriveCategory,
  deriveStatus,
  toExpiresInSeconds,
} from '../../src/data/types.js';

describe('deriveCategory', () => {
  it.each([
    ['auth.login.success', 'auth'],
    ['auth.step_up.failed', 'auth'],
    ['auth_method.added', 'auth'],
    ['user.suspended', 'user-lifecycle'],
    ['user.role_changed', 'user-lifecycle'],
    ['invitation.created', 'invitation-lifecycle'],
    ['pairing_code.redeemed', 'invitation-lifecycle'],
    ['recovery_used', 'recovery'],
    ['wrapping_invariant_violated', 'security'],
    ['refresh_token.reuse_detected', 'security'],
    ['primary_admin.transferred', 'admin-action'],
  ] as const)('%s → %s', (eventType, category) => {
    expect(deriveCategory(eventType)).toBe(category);
  });

  it('falls back to admin-action for unknown types', () => {
    expect(deriveCategory('future.event')).toBe('admin-action');
  });
});

describe('deriveStatus', () => {
  it('is suspended when suspended_at is set', () => {
    expect(deriveStatus('2026-01-01T00:00:00Z')).toBe('suspended');
  });
  it('is active when suspended_at is null', () => {
    expect(deriveStatus(null)).toBe('active');
  });
});

describe('toExpiresInSeconds', () => {
  it.each([
    [1, 86_400],
    [7, 604_800],
    [30, 2_592_000],
  ] as const)('%s days → %s seconds', (days, seconds) => {
    expect(toExpiresInSeconds(days)).toBe(seconds);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/admin-client && pnpm vitest run tests/unit/data-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/admin-client/src/data/types.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

// Client-side view-models and derivations. Wire truth lives in
// @chatsundere/shared-types; everything here is presentation-side.

import type {
  AdminAuditLogEntry,
  AdminInvitationStatus,
  AdminUserDetail,
  AdminUserSummary,
} from '@chatsundere/shared-types';

export type UserStatus = 'active' | 'suspended';

export type AuditEventCategory =
  | 'auth'
  | 'user-lifecycle'
  | 'invitation-lifecycle'
  | 'recovery'
  | 'security'
  | 'admin-action';

export interface UserRow extends AdminUserSummary {
  status: UserStatus;
}

export interface UserDetailView extends AdminUserDetail {
  status: UserStatus;
  /**
   * Derived, not fetched: the DB's partial unique index guarantees at most one
   * primary_admin, so the current primary is always the last one.
   */
  is_last_primary_admin: boolean;
}

export interface AuditRow extends AdminAuditLogEntry {
  category: AuditEventCategory;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface DashboardSummary {
  total_users: number;
  suspended_users: number;
  pending_invitations: number;
  /** Soonest expiry among the first page (≤100) of pending invitations. */
  soonest_pending_expiry: string | null;
  events_24h: number;
  recent_activity: AuditRow[];
}

export interface UserListQuery {
  search?: string;
  role?: 'user' | 'admin' | 'primary_admin' | 'all';
  status?: UserStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface InvitationListQuery {
  status?: AdminInvitationStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface AuditListQuery {
  event_type?: string;
  user_id?: string;
  /** Date-input value (YYYY-MM-DD); mapped to the wire `since` at start of day UTC. */
  from?: string;
  /** Date-input value (YYYY-MM-DD); mapped to the wire `until` at end of day UTC. */
  to?: string;
  page?: number;
  per_page?: number;
}

export interface CreateInvitationInput {
  role: 'user' | 'admin';
  expires_in_days: 1 | 7 | 30;
  issuer_label?: string;
  suggested_username?: string;
  note?: string;
}

/**
 * Presentation grouping for event types. Pinned in the spec (§6.3); unknown
 * types deliberately land in admin-action rather than throwing.
 */
export function deriveCategory(eventType: string): AuditEventCategory {
  if (eventType === 'wrapping_invariant_violated' || eventType === 'refresh_token.reuse_detected') {
    return 'security';
  }
  if (eventType === 'recovery_used') return 'recovery';
  if (eventType.startsWith('auth.') || eventType.startsWith('auth_method.')) return 'auth';
  if (eventType.startsWith('user.')) return 'user-lifecycle';
  if (eventType.startsWith('invitation.') || eventType.startsWith('pairing_code.')) {
    return 'invitation-lifecycle';
  }
  return 'admin-action';
}

/** A user is suspended exactly when the server has a suspended_at timestamp. */
export function deriveStatus(suspendedAt: string | null): UserStatus {
  return suspendedAt === null ? 'active' : 'suspended';
}

/** The UI offers day choices; the wire wants seconds. */
export function toExpiresInSeconds(days: 1 | 7 | 30): number {
  return days * 86_400;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/admin-client && pnpm vitest run tests/unit/data-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-client/src/data/types.ts apps/admin-client/tests/unit/data-types.test.ts
git commit -m "Add admin-client view-model types and derivations"
```

---

### Task 5: Live API module (`api.ts`)

**Files:**
- Create: `apps/admin-client/src/data/api.ts`
- Test: `apps/admin-client/tests/unit/data-api.test.ts`

**Interfaces:**
- Consumes: `apiFetch`/`HttpError` from `src/lib/fetch.ts` (bearer auth + step-up gate built in), types from Tasks 1 and 4, `env.VITE_AUTH_URL`.
- Produces (exact signatures — routes migrate to these in Tasks 6–11):

```ts
export function listUsers(query: UserListQuery): Promise<Paged<UserRow>>
export function getUser(id: string): Promise<UserDetailView>
export function suspendUser(id: string): Promise<void>
export function unsuspendUser(id: string): Promise<void>
export function deleteUser(id: string): Promise<void>
export function changeRole(id: string, role: 'admin' | 'user'): Promise<void>
export function transferPrimary(targetUserId: string): Promise<void>
export function listInvitations(query: InvitationListQuery): Promise<Paged<AdminInvitationSummary>>
export function createInvitation(input: CreateInvitationInput): Promise<AdminCreateInvitationResponse>
export function revokeInvitation(id: string): Promise<void>
export function listAudit(query: AuditListQuery): Promise<Paged<AuditRow>>
export function getDashboardSummary(): Promise<DashboardSummary>
```

- [ ] **Step 1: Write the failing tests**

Create `apps/admin-client/tests/unit/data-api.test.ts`. Mock the fetch layer so the tests assert **wire mapping**, not HTTP:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/fetch.js', () => ({
  apiFetch: (opts: unknown) => apiFetchMock(opts),
  HttpError: class HttpError extends Error {},
}));
vi.mock('../../src/env.js', () => ({
  env: { VITE_AUTH_URL: 'http://auth.test' },
}));

import {
  createInvitation,
  getDashboardSummary,
  getUser,
  listAudit,
  listUsers,
} from '../../src/data/api.js';

interface FetchOpts {
  baseUrl: string;
  path: string;
  json?: unknown;
  method?: string;
}

function callPath(n: number): string {
  const call = apiFetchMock.mock.calls[n]?.[0] as FetchOpts | undefined;
  return call?.path ?? '';
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('listUsers', () => {
  it('maps page/per_page to limit/offset and drops all-filters', async () => {
    apiFetchMock.mockResolvedValue({ users: [], total: 0 });
    await listUsers({ search: 'ali', role: 'all', status: 'suspended', page: 3, per_page: 20 });
    const path = callPath(0);
    expect(path).toContain('/api/v1/admin/users?');
    expect(path).toContain('q=ali');
    expect(path).not.toContain('role=');
    expect(path).toContain('status=suspended');
    expect(path).toContain('limit=20');
    expect(path).toContain('offset=40');
  });

  it('wraps the response into Paged with derived status', async () => {
    apiFetchMock.mockResolvedValue({
      users: [
        {
          id: 'u1',
          username: 'alice',
          role: 'user',
          suspended_at: null,
          created_at: '2026-01-01T00:00:00Z',
          last_login_at: null,
        },
      ],
      total: 41,
    });
    const page = await listUsers({ page: 2, per_page: 20 });
    expect(page.total).toBe(41);
    expect(page.page).toBe(2);
    expect(page.per_page).toBe(20);
    expect(page.items[0]?.status).toBe('active');
  });
});

describe('getUser', () => {
  it('derives status and is_last_primary_admin', async () => {
    apiFetchMock.mockResolvedValue({
      id: 'u2',
      username: 'root',
      role: 'primary_admin',
      suspended_at: null,
      created_at: '2026-01-01T00:00:00Z',
      last_login_at: null,
      auth_methods: [],
    });
    const detail = await getUser('u2');
    expect(detail.status).toBe('active');
    expect(detail.is_last_primary_admin).toBe(true);
  });
});

describe('listAudit', () => {
  it('maps from/to to since/until (UTC day bounds) and derives category', async () => {
    apiFetchMock.mockResolvedValue({
      entries: [
        {
          id: 'a1',
          user_id: null,
          actor_user_id: null,
          user_username: null,
          actor_username: null,
          event_type: 'auth.login.failed',
          metadata: {},
          created_at: '2026-07-01T12:00:00Z',
        },
      ],
      total: 1,
    });
    const page = await listAudit({ from: '2026-07-01', to: '2026-07-02', page: 1 });
    const path = callPath(0);
    expect(path).toContain(encodeURIComponent('2026-07-01T00:00:00.000Z'));
    expect(path).toContain(encodeURIComponent('2026-07-02T23:59:59.999Z'));
    expect(page.items[0]?.category).toBe('auth');
  });
});

describe('createInvitation', () => {
  it('converts days to seconds and passes optional fields through', async () => {
    apiFetchMock.mockResolvedValue({
      invitation_id: 'i1',
      code: 'ABCDEFGHIJ',
      qr_url: 'http://x/join#ABCDEFGHIJ',
      expires_at: '2026-07-11T00:00:00Z',
      state: 'active',
    });
    await createInvitation({
      role: 'user',
      expires_in_days: 7,
      suggested_username: 'newbie',
      note: 'from Discord',
    });
    const call = apiFetchMock.mock.calls[0]?.[0] as FetchOpts;
    expect(call.json).toEqual({
      role: 'user',
      expires_in_seconds: 604_800,
      suggested_username: 'newbie',
      note: 'from Discord',
    });
  });
});

describe('getDashboardSummary', () => {
  it('composes totals from the list endpoints', async () => {
    apiFetchMock.mockImplementation((opts: FetchOpts) => {
      const p = opts.path;
      if (p.includes('/admin/users') && p.includes('status=suspended')) {
        return Promise.resolve({ users: [], total: 2 });
      }
      if (p.includes('/admin/users')) return Promise.resolve({ users: [], total: 12 });
      if (p.includes('/admin/invitations')) {
        return Promise.resolve({
          invitations: [
            { expires_at: '2026-07-06T00:00:00Z', status: 'pending' },
            { expires_at: '2026-07-05T00:00:00Z', status: 'pending' },
          ],
          total: 3,
        });
      }
      if (p.includes('since=')) return Promise.resolve({ entries: [], total: 247 });
      return Promise.resolve({ entries: [], total: 999 });
    });
    const summary = await getDashboardSummary();
    expect(summary.total_users).toBe(12);
    expect(summary.suspended_users).toBe(2);
    expect(summary.pending_invitations).toBe(3);
    expect(summary.soonest_pending_expiry).toBe('2026-07-05T00:00:00Z');
    expect(summary.events_24h).toBe(247);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/admin-client && pnpm vitest run tests/unit/data-api.test.ts`
Expected: FAIL — `src/data/api.ts` does not exist.

- [ ] **Step 3: Implement**

Create `apps/admin-client/src/data/api.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

// The one live data layer. Every function talks to auth-service through
// apiFetch (bearer auth + the step-up gate) and returns view-models from
// ./types.js. Wire truth: @chatsundere/shared-types.

import type {
  AdminAuditLogResponse,
  AdminCreateInvitationRequest,
  AdminCreateInvitationResponse,
  AdminInvitationListResponse,
  AdminInvitationSummary,
  AdminUserDetail,
  AdminUserListResponse,
} from '@chatsundere/shared-types';
import { env } from '../env.js';
import { apiFetch } from '../lib/fetch.js';
import {
  type AuditListQuery,
  type AuditRow,
  type CreateInvitationInput,
  type DashboardSummary,
  type InvitationListQuery,
  type Paged,
  type UserDetailView,
  type UserListQuery,
  type UserRow,
  deriveCategory,
  deriveStatus,
  toExpiresInSeconds,
} from './types.js';

const DEFAULT_PER_PAGE = 20;

function pagination(query: { page?: number; per_page?: number }): {
  page: number;
  perPage: number;
  params: URLSearchParams;
} {
  const page = Math.max(1, query.page ?? 1);
  const perPage = query.per_page ?? DEFAULT_PER_PAGE;
  const params = new URLSearchParams();
  params.set('limit', String(perPage));
  params.set('offset', String((page - 1) * perPage));
  return { page, perPage, params };
}

export async function listUsers(query: UserListQuery): Promise<Paged<UserRow>> {
  const { page, perPage, params } = pagination(query);
  if (query.search) params.set('q', query.search);
  if (query.role && query.role !== 'all') params.set('role', query.role);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  const res = await apiFetch<AdminUserListResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users?${params.toString()}`,
    authMode: 'bearer',
  });
  return {
    items: res.users.map((u) => ({ ...u, status: deriveStatus(u.suspended_at) })),
    total: res.total,
    page,
    per_page: perPage,
  };
}

export async function getUser(id: string): Promise<UserDetailView> {
  const res = await apiFetch<AdminUserDetail>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}`,
    authMode: 'bearer',
  });
  return {
    ...res,
    status: deriveStatus(res.suspended_at),
    // The partial unique index allows at most one primary_admin, so the
    // current primary is by definition the last one.
    is_last_primary_admin: res.role === 'primary_admin',
  };
}

export async function suspendUser(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}/suspend`,
    method: 'POST',
    authMode: 'bearer',
  });
}

export async function unsuspendUser(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}/unsuspend`,
    method: 'POST',
    authMode: 'bearer',
  });
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}`,
    method: 'DELETE',
    authMode: 'bearer',
  });
}

export async function changeRole(id: string, role: 'admin' | 'user'): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}/role`,
    json: { role },
    authMode: 'bearer',
  });
}

export async function transferPrimary(targetUserId: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: '/api/v1/admin/transfer-primary',
    json: { target_user_id: targetUserId },
    authMode: 'bearer',
  });
}

export async function listInvitations(
  query: InvitationListQuery,
): Promise<Paged<AdminInvitationSummary>> {
  const { page, perPage, params } = pagination(query);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  const res = await apiFetch<AdminInvitationListResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/invitations?${params.toString()}`,
    authMode: 'bearer',
  });
  return { items: res.invitations, total: res.total, page, per_page: perPage };
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<AdminCreateInvitationResponse> {
  const body: AdminCreateInvitationRequest = {
    role: input.role,
    expires_in_seconds: toExpiresInSeconds(input.expires_in_days),
    ...(input.issuer_label ? { issuer_label: input.issuer_label } : {}),
    ...(input.suggested_username ? { suggested_username: input.suggested_username } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  return apiFetch<AdminCreateInvitationResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: '/api/v1/admin/invitations',
    json: body,
    authMode: 'bearer',
  });
}

export async function revokeInvitation(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/invitations/${encodeURIComponent(id)}`,
    method: 'DELETE',
    authMode: 'bearer',
  });
}

function toAuditRow(entry: AdminAuditLogResponse['entries'][number]): AuditRow {
  return { ...entry, category: deriveCategory(entry.event_type) };
}

export async function listAudit(query: AuditListQuery): Promise<Paged<AuditRow>> {
  const { page, perPage, params } = pagination(query);
  if (query.event_type) params.set('event_type', query.event_type);
  if (query.user_id) params.set('user_id', query.user_id);
  if (query.from) params.set('since', `${query.from}T00:00:00.000Z`);
  if (query.to) params.set('until', `${query.to}T23:59:59.999Z`);
  const res = await apiFetch<AdminAuditLogResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/audit-log?${params.toString()}`,
    authMode: 'bearer',
  });
  return { items: res.entries.map(toAuditRow), total: res.total, page, per_page: perPage };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [allUsers, suspended, pending, last24h, recent] = await Promise.all([
    listUsers({ page: 1, per_page: 1 }),
    listUsers({ status: 'suspended', page: 1, per_page: 1 }),
    listInvitations({ status: 'pending', page: 1, per_page: 100 }),
    apiFetch<AdminAuditLogResponse>({
      baseUrl: env.VITE_AUTH_URL,
      path: `/api/v1/admin/audit-log?since=${encodeURIComponent(sinceIso)}&limit=1`,
      authMode: 'bearer',
    }),
    listAudit({ page: 1, per_page: 10 }),
  ]);
  // Soonest expiry across the fetched pending page (≤100 — phase-0 honesty:
  // beyond that the subline may miss an earlier expiry, which is acceptable
  // while invitation counts are small).
  const soonest = pending.items.reduce<string | null>(
    (min, inv) => (min === null || inv.expires_at < min ? inv.expires_at : min),
    null,
  );
  return {
    total_users: allUsers.total,
    suspended_users: suspended.total,
    pending_invitations: pending.total,
    soonest_pending_expiry: soonest,
    events_24h: last24h.total,
    recent_activity: recent.items,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/admin-client && pnpm vitest run tests/unit/data-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-client/src/data/api.ts apps/admin-client/tests/unit/data-api.test.ts
git commit -m "Add live admin API module with pagination and view-model mapping"
```

---

### Task 6: Shared error panel + audit screen migration

**Files:**
- Create: `apps/admin-client/src/components/QueryErrorPanel.tsx`
- Modify: `apps/admin-client/src/routes/audit/index.tsx`
- Modify: `apps/admin-client/src/copy.ts` (audit + error strings)

**Interfaces:**
- Consumes: `listAudit`, `AuditRow`, `AuditEventCategory`, `deriveCategory` (Tasks 4–5).
- Produces: `QueryErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void })` — used by every screen migration after this task. `EVENT_TYPE_GROUPS` (audit route-local constant).

- [ ] **Step 1: Add the error panel component**

Create `apps/admin-client/src/components/QueryErrorPanel.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { copy } from '../copy.js';
import { HttpError } from '../lib/fetch.js';

interface Props {
  error: unknown;
  onRetry: () => void;
}

/**
 * The constructive failure state: name what went wrong, offer the next step.
 * Replaces every eternal-spinner branch (the old blank audit screen).
 */
export function QueryErrorPanel({ error, onRetry }: Props) {
  const detail =
    error instanceof HttpError
      ? `${error.status}${error.code ? ` · ${error.code}` : ''}`
      : copy.errors.network;
  return (
    <div
      role="alert"
      className="space-y-3 rounded-md border border-[var(--color-red)] bg-[var(--color-mantle)] p-4"
    >
      <p className="text-[var(--color-red)]">{copy.errors.queryFailedTitle}</p>
      <p className="font-mono text-xs text-[var(--color-subtext-0)]">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-[var(--color-mauve)] px-3 py-1 text-[var(--color-base)]"
      >
        {copy.errors.retry}
      </button>
    </div>
  );
}
```

Add to `apps/admin-client/src/copy.ts` (top level of the `copy` object):

```ts
  errors: {
    queryFailedTitle: 'The server could not be reached or refused the request.',
    network: 'network unreachable',
    retry: 'Retry',
  },
```

- [ ] **Step 2: Migrate the audit screen**

Rewrite `apps/admin-client/src/routes/audit/index.tsx` with these exact changes (keep the file structure, reducer pattern, and expand/collapse behaviour):

1. Replace the api/type imports:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useReducer, useState } from 'react';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
import { copy } from '../../copy.js';
import { listAudit } from '../../data/api.js';
import type { AuditEventCategory } from '../../data/types.js';
import { formatRelative } from '../../lib/format.js';
```

2. The filter state swaps `category` for `event_type` (the server filters by exact event type; category grouping is visual — spec §6.3):

```tsx
interface AuditFilter {
  event_type: string; // '' = all
  user_id: string;
  from: string;
  to: string;
  page: number;
}
```

Adjust `initial`, the action union (`{ type: 'event_type'; value: string }` replaces the category action), and the reducer case accordingly (every non-page action still resets `page` to 1).

3. Add the grouped dropdown data above the component (route-local; unknown server additions degrade gracefully because filtering is server-side and display falls back via `deriveCategory`):

```tsx
const EVENT_TYPE_GROUPS: ReadonlyArray<{
  category: AuditEventCategory;
  types: readonly string[];
}> = [
  {
    category: 'auth',
    types: [
      'auth.login.success',
      'auth.login.failed',
      'auth.logout',
      'auth.step_up.confirmed',
      'auth.step_up.failed',
      'auth_method.added',
      'auth_method.removed',
      'auth_method.passphrase_changed',
    ],
  },
  {
    category: 'user-lifecycle',
    types: [
      'user.linked',
      'user.suspended',
      'user.unsuspended',
      'user.deleted_by_admin',
      'user.self_deleted',
      'user.role_changed',
      'user.username_changed',
    ],
  },
  {
    category: 'invitation-lifecycle',
    types: [
      'invitation.created',
      'invitation.revoked',
      'invitation.redeemed',
      'pairing_code.created',
      'pairing_code.revoked',
      'pairing_code.redeemed',
    ],
  },
  { category: 'recovery', types: ['recovery_used'] },
  {
    category: 'security',
    types: ['wrapping_invariant_violated', 'refresh_token.reuse_detected'],
  },
  { category: 'admin-action', types: ['primary_admin.transferred'] },
];
```

4. The query:

```tsx
  const { data, error, refetch } = useQuery({
    queryKey: ['audit', filter],
    queryFn: () =>
      listAudit({
        ...(filter.event_type ? { event_type: filter.event_type } : {}),
        ...(filter.user_id ? { user_id: filter.user_id } : {}),
        ...(filter.from ? { from: filter.from } : {}),
        ...(filter.to ? { to: filter.to } : {}),
        page: filter.page,
      }),
    placeholderData: (prev) => prev,
  });
```

5. The category `<select>` becomes an event-type `<select>` with `<optgroup>` per category:

```tsx
        <select
          value={filter.event_type}
          onChange={(e) => dispatch({ type: 'event_type', value: e.target.value })}
          className="rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
        >
          <option value="">{copy.audit.filters.allEvents}</option>
          {EVENT_TYPE_GROUPS.map((group) => (
            <optgroup key={group.category} label={copy.audit.categories[group.category]}>
              {group.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
```

6. Error handling replaces the bare `!data` branch:

```tsx
      {error ? (
        <QueryErrorPanel error={error} onRetry={() => void refetch()} />
      ) : !data ? (
        <p className="text-[var(--color-subtext-0)]">{copy.loading}</p>
      ) : data.items.length === 0 ? (
        ...unchanged...
```

7. Row rendering — field renames plus the category badge and the deleted-user marker. Columns become: timestamp, category, event type, actor, subject, metadata. In the row:

```tsx
                  <td className="py-2">{formatRelative(e.created_at)}</td>
                  <td className="py-2">
                    <span className="rounded-sm bg-[var(--color-mantle)] px-2 py-0.5 font-mono text-xs">
                      {copy.audit.categories[e.category]}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-xs">{e.event_type}</td>
                  <td className="py-2">{renderUser(e.actor_username, e.actor_user_id)}</td>
                  <td className="py-2">{renderUser(e.user_username, e.user_id)}</td>
```

with the helper above the component:

```tsx
/** Deleted users keep their id in old entries; show it truncated and marked. */
function renderUser(username: string | null, id: string | null): string {
  if (username) return username;
  if (id) return `${id.slice(0, 8)}… (${'deleted'})`;
  return '—';
}
```

Move the literal `'deleted'` into copy as `copy.audit.deletedUser` and interpolate it.

8. Copy updates in `src/copy.ts` under `audit`: add `filters.allEvents: 'All events'`, `deletedUser: 'deleted'`, add `categories.security: 'Security'`, and rename the `columns.subject` label to `'Subject'` if it is not already; add `columns.category: 'Category'`.

- [ ] **Step 3: Typecheck and run the client suite**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: typecheck green (the old data layer still exists untouched); all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-client/src/components/QueryErrorPanel.tsx apps/admin-client/src/routes/audit/index.tsx apps/admin-client/src/copy.ts
git commit -m "Wire the audit screen to the live audit-log endpoint"
```

---

### Task 7: Users list + detail migration

**Files:**
- Modify: `apps/admin-client/src/routes/users/index.tsx`
- Modify: `apps/admin-client/src/routes/users/detail.tsx`
- Modify: `apps/admin-client/src/routes/users/actions.tsx` (imports only in this task)

**Interfaces:**
- Consumes: `listUsers`, `getUser` (Task 5), `QueryErrorPanel` (Task 6), `UserDetailView`/`UserStatus` (Task 4).
- Produces: `UserActions` prop type becomes `{ user: UserDetailView; onDeleted: () => void }` — Tasks 8–9 build on that.

- [ ] **Step 1: Migrate the list screen**

In `apps/admin-client/src/routes/users/index.tsx`:

- Replace `import type { UserStatus } from '../../data/admin-api.js'` with `import type { UserStatus } from '../../data/types.js'`.
- Replace `import { getAdminApi } from '../../data/index.js'` with `import { listUsers } from '../../data/api.js'` and drop the `const api = getAdminApi();` line.
- The query becomes:

```tsx
  const { data, error, refetch } = useQuery({
    queryKey: ['users', filter],
    queryFn: () => listUsers(filter),
    placeholderData: (prev) => prev,
  });
```

- Add the error branch before the loading branch (same pattern as Task 6 step 2.6), importing `QueryErrorPanel`.
- The row rendering is unchanged (`u.status` still exists — now derived in the data layer).

- [ ] **Step 2: Migrate the detail screen**

In `apps/admin-client/src/routes/users/detail.tsx`:

- Swap `getAdminApi` for `import { getUser } from '../../data/api.js'`; query becomes `queryFn: () => getUser(id)` (plus `error`/`refetch` destructuring and the `QueryErrorPanel` branch).
- Auth-method rendering: the server sends `method_type` (`'opaque' | 'passkey'`), not `type`, and `label` is nullable. Replace the list item content:

```tsx
                    <span>
                      {m.label ?? copy.userDetail.unnamedMethod} ({m.method_type === 'opaque' ? copy.userDetail.methodPassphrase : copy.userDetail.methodPasskey})
                    </span>
```

Add to `copy.ts` under `userDetail`: `unnamedMethod: 'Unnamed method'`, `methodPassphrase: 'passphrase'`, `methodPasskey: 'passkey'`.

- [ ] **Step 3: Retype the actions component (mechanical, no behaviour change yet)**

In `apps/admin-client/src/routes/users/actions.tsx`, replace `import type { UserDetail } from '../../data/admin-api.js'` with `import type { UserDetailView } from '../../data/types.js'`, change the `Props.user` type to `UserDetailView`, replace `getAdminApi()` usage with direct function imports:

```tsx
import { deleteUser, suspendUser, transferPrimary, unsuspendUser } from '../../data/api.js';
```

and update the four mutations to call them (`mutationFn: () => suspendUser(user.id)` etc.). `user.is_last_primary_admin === true` simplifies to `user.is_last_primary_admin` (now a required boolean).

- [ ] **Step 4: Typecheck, test, commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: green (the `users-list-filter` reducer test is untouched and still passes).

```bash
git add apps/admin-client/src/routes/users apps/admin-client/src/copy.ts
git commit -m "Wire the users screens to the live admin endpoints"
```

---

### Task 8: Change-role becomes real

**Files:**
- Modify: `apps/admin-client/src/routes/users/actions.tsx`
- Modify: `apps/admin-client/src/copy.ts`

**Interfaces:**
- Consumes: `changeRole(id, role)` (Task 5). Gating contract from the placeholder comment at `actions.tsx:101-109` (Larissa Squash C, finding S1) — it is binding.

- [ ] **Step 1: Replace the placeholder button with a role section**

In `actions.tsx`, add imports for `changeRole` and `useState` (already present). Replace the entire placeholder `<ActionButton label={copy.userDetail.actions.changeRole} ... />` block with:

```tsx
      <RoleSection
        user={user}
        disabled={isSelf || isLastPrimary || !sessionIsPrimary}
        tooltip={
          selfTooltip ??
          lastPrimaryTooltip ??
          (sessionIsPrimary ? undefined : copy.userDetail.primaryOnlyTooltip)
        }
      />
```

and add below `ActionButton` in the same file:

```tsx
function RoleSection({
  user,
  disabled,
  tooltip,
}: {
  user: UserDetailView;
  disabled: boolean;
  tooltip?: string;
}) {
  const qc = useQueryClient();
  // primary_admin is not assignable via this endpoint; transfer-primary owns it.
  const [nextRole, setNextRole] = useState<'admin' | 'user'>(
    user.role === 'admin' ? 'user' : 'admin',
  );
  const mutation = useMutation({
    mutationFn: () => changeRole(user.id, nextRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user', user.id] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const blocked = disabled || mutation.isPending || nextRole === user.role;
  return (
    <div className="space-y-1">
      <label className="block text-sm">
        {copy.userDetail.actions.changeRole}
        <select
          value={nextRole}
          disabled={disabled}
          onChange={(e) => setNextRole(e.target.value === 'admin' ? 'admin' : 'user')}
          className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-base)] px-3 py-2 disabled:opacity-50"
        >
          <option value="user">{copy.userDetail.roleOptions.user}</option>
          <option value="admin">{copy.userDetail.roleOptions.admin}</option>
        </select>
      </label>
      <button
        type="button"
        disabled={blocked}
        title={tooltip}
        onClick={() => {
          // Defence-in-depth (S1): re-check every gate at click time.
          if (blocked) return;
          mutation.mutate();
        }}
        className="w-full rounded-md bg-[var(--color-mantle)] px-3 py-2 text-left disabled:opacity-50"
      >
        {copy.userDetail.applyRole}
        {tooltip && disabled && (
          <span className="ml-2 block text-xs text-[var(--color-subtext-0)]">{tooltip}</span>
        )}
      </button>
      {mutation.isError && (
        <p className="text-xs text-[var(--color-red)]">{copy.userDetail.roleChangeFailed}</p>
      )}
    </div>
  );
}
```

Remove the now-dead `copy.userDetail.changeRoleNotYetAvailable` string and add under `userDetail`:

```ts
    roleOptions: { user: 'User', admin: 'Admin' },
    applyRole: 'Apply role change',
    roleChangeFailed: 'Role change failed — the server refused it. Check the audit log.',
```

- [ ] **Step 2: Typecheck, test, commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: green.

```bash
git add apps/admin-client/src/routes/users/actions.tsx apps/admin-client/src/copy.ts
git commit -m "Enable role changes from the user detail screen"
```

---

### Task 9: Transfer-primary — typed-phrase confirm + sign-out notice

**Files:**
- Modify: `apps/admin-client/src/routes/users/actions.tsx`
- Modify: `apps/admin-client/src/routes/login/index.tsx`
- Modify: `apps/admin-client/src/copy.ts`

**Interfaces:**
- Consumes: `transferPrimary` (Task 5), `ConfirmTyped` from `@chatsundere/ui-shared` (already imported in `actions.tsx` — see the delete flow at `actions.tsx:142-164` for the exact prop set), `useSessionStore.closeAndForget` (see `routes/root.tsx:9-15`).
- Produces: login screen renders `location.state.notice` — reusable for future forced sign-outs.

- [ ] **Step 1: Wrap the transfer in ConfirmTyped and sign out on success**

In `actions.tsx`:

1. Add state next to `confirmDeleteOpen`:

```tsx
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);
```

2. Add `useNavigate` (`import { useNavigate } from 'react-router-dom';`) and `const navigate = useNavigate();` plus `const closeAndForget = useSessionStore((s) => s.closeAndForget);` inside `UserActions`.

3. Replace the `transfer` mutation:

```tsx
  const transfer = useMutation({
    mutationFn: () => transferPrimary(user.id),
    onSuccess: () => {
      // The in-memory access token still claims primary_admin; signing out is
      // the honest state (spec §6.7). The login screen shows the notice.
      closeAndForget();
      navigate('/login', {
        replace: true,
        state: { notice: copy.userDetail.transferredNotice(user.username) },
      });
    },
  });
```

4. The transfer `ActionButton.onClick` changes to open the dialog instead of mutating directly:

```tsx
        onClick={() => {
          if (isSelf || !sessionIsPrimary || user.role !== 'admin' || transfer.isPending) return;
          setConfirmTransferOpen(true);
        }}
```

5. Add a second `ConfirmTyped` below the delete one (mirroring its defence-in-depth gating pattern):

```tsx
      <ConfirmTyped
        open={confirmTransferOpen && !isSelf && sessionIsPrimary && user.role === 'admin'}
        title={copy.userDetail.transferConfirm.title}
        body={copy.userDetail.transferConfirm.body}
        confirmToken={user.username}
        confirmTokenLabel={copy.userDetail.transferConfirm.tokenLabel}
        destructiveCta={copy.userDetail.transferConfirm.cta}
        cancelCta={copy.userDetail.transferConfirm.cancel}
        busy={transfer.isPending}
        onCancel={() => setConfirmTransferOpen(false)}
        onConfirm={() => {
          if (isSelf || !sessionIsPrimary || user.role !== 'admin' || transfer.isPending) {
            setConfirmTransferOpen(false);
            return;
          }
          transfer.mutate();
        }}
      />
```

6. Copy additions under `userDetail`:

```ts
    transferredNotice: (username: string) =>
      `Primary role transferred to ${username}. Sign in again — your session now carries the admin role.`,
    transferConfirm: {
      title: 'Transfer primary role',
      body: 'This hands the primary-admin role to this user and demotes you to admin. You will be signed out afterwards.',
      tokenLabel: "Type the target's username to confirm",
      cta: 'Transfer and sign out',
      cancel: 'Cancel',
    },
```

- [ ] **Step 2: Render the notice on the login screen**

In `apps/admin-client/src/routes/login/index.tsx`, read the router state near the top of the component (add `useLocation` to the react-router-dom import):

```tsx
  const location = useLocation();
  const notice =
    typeof (location.state as { notice?: unknown } | null)?.notice === 'string'
      ? ((location.state as { notice: string }).notice)
      : null;
```

and render it above the form (adapt placement to the file's actual JSX — it is a card layout):

```tsx
      {notice && (
        <p role="status" className="rounded-md border border-[var(--color-green)] px-3 py-2 text-sm text-[var(--color-green)]">
          {notice}
        </p>
      )}
```

- [ ] **Step 3: Typecheck, test, commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: green (the login decision-tree integration test must still pass — the notice renders only with router state present).

```bash
git add apps/admin-client/src/routes/users/actions.tsx apps/admin-client/src/routes/login/index.tsx apps/admin-client/src/copy.ts
git commit -m "Guard transfer-primary with a typed confirmation and sign out on success"
```

---

### Task 10: Invitations migration (list, create, reveal-once)

**Files:**
- Modify: `apps/admin-client/src/routes/invitations/index.tsx`
- Modify: `apps/admin-client/src/routes/invitations/create-modal.tsx`
- Modify: `apps/admin-client/src/routes/invitations/reveal-screen.tsx`
- Modify: `apps/admin-client/src/copy.ts`
- Modify: `apps/admin-client/tests/integration/invitation-create.test.tsx`

**Interfaces:**
- Consumes: `listInvitations`, `createInvitation`, `revokeInvitation` (Task 5), `AdminCreateInvitationResponse`/`AdminInvitationStatus`/`AdminInvitationSummary` (Task 1), `CreateInvitationInput` (Task 4).

- [ ] **Step 1: Migrate the list screen**

In `invitations/index.tsx`:

- Imports: drop `getAdminApi` + local types; add

```tsx
import type { AdminCreateInvitationResponse, AdminInvitationStatus } from '@chatsundere/shared-types';
import { listInvitations, revokeInvitation } from '../../data/api.js';
import { QueryErrorPanel } from '../../components/QueryErrorPanel.js';
```

- State: `useState<AdminInvitationStatus | 'all'>('all')` and `useState<AdminCreateInvitationResponse | null>(null)` for `revealed`.
- Query/mutation: `queryFn: () => listInvitations({ status: filter })` (destructure `error`, `refetch`; add the `QueryErrorPanel` branch) and `mutationFn: (id: string) => revokeInvitation(id)`.
- Row field rename: `{inv.redeemed_by ?? '—'}` becomes `{inv.redeemed_by_user_id ?? '—'}`. Add a `suggested_username` column right after `role`: header `copy.invitations.columns.suggestedUsername`, cell `{inv.suggested_username ?? '—'}`. Copy addition under `invitations.columns`: `suggestedUsername: 'Suggested username'`.

- [ ] **Step 2: Migrate the create modal**

In `create-modal.tsx`: imports become

```tsx
import type { AdminCreateInvitationResponse } from '@chatsundere/shared-types';
import type { CreateInvitationInput } from '../../data/types.js';
import { createInvitation } from '../../data/api.js';
```

`Props.onCreated` takes `AdminCreateInvitationResponse`; the mutation is `mutationFn: (input: CreateInvitationInput) => createInvitation(input)`. The role state narrows to `'user' | 'admin'` (the old local type allowed `primary_admin`; the server rejects it — remove the impossible option if present in the select; it is not, so only the type changes). Add an inline error line under the buttons so a declined step-up keeps the filled form visible with feedback (spec §6.8):

```tsx
      {create.isError && (
        <p className="text-xs text-[var(--color-red)]">{copy.invitations.modal.failed}</p>
      )}
```

Copy addition under `invitations.modal`: `failed: 'Creating the invitation failed. Step-up is required — try again when ready; your input is preserved.'`

- [ ] **Step 3: Rewrite the reveal screen for code + qr_url**

In `reveal-screen.tsx`, the prop becomes `invitation: AdminCreateInvitationResponse`. The QR encodes `invitation.qr_url`; the URL input shows `invitation.qr_url`; add a code block between warning and canvas showing the bare 10-character code (URL+code two-field UX):

```tsx
      <div className="text-center font-mono text-2xl tracking-[0.3em]">{invitation.code}</div>
```

Copy-URL button copies `invitation.qr_url`; add a second button `copy.invitations.reveal.copyCode` copying `invitation.code`. Effect dependency changes to `invitation.qr_url`. Copy addition under `invitations.reveal`: `copyCode: 'Copy code'` — and reword `warning` to name the consequence + next step: `'Shown once only. If you lose the code, revoke this invitation and issue a new one.'`

- [ ] **Step 4: Update the create integration test to pin input preservation across step-up**

Open `apps/admin-client/tests/integration/invitation-create.test.tsx`, read how it currently drives the modal (it targets the mock layer today). Rework it to mock `../../src/data/api.js` instead:

- Mock `createInvitation` to reject once (simulating a declined step-up producing an `HttpError`), assert the form's inputs still hold their typed values and the failure line renders; then resolve on the second submit and assert `onCreated` receives the response object.
- Keep the test structural (assert field values and callback payloads, not copy phrases — match the failure line via `role`/test-id, not its exact wording).

- [ ] **Step 5: Typecheck, test, commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: green, including the reworked integration test.

```bash
git add apps/admin-client/src/routes/invitations apps/admin-client/src/copy.ts apps/admin-client/tests/integration/invitation-create.test.tsx
git commit -m "Wire invitations to the live endpoints with reveal-once code display"
```

---

### Task 11: Dashboard migration

**Files:**
- Modify: `apps/admin-client/src/routes/dashboard/index.tsx`
- Modify: `apps/admin-client/src/copy.ts`

**Interfaces:**
- Consumes: `getDashboardSummary` + `DashboardSummary` (Tasks 4–5), `QueryErrorPanel` (Task 6).

- [ ] **Step 1: Migrate**

In `dashboard/index.tsx`:

- Imports: swap `getAdminApi` for `import { getDashboardSummary } from '../../data/api.js';` plus `QueryErrorPanel`.
- Query: `queryFn: () => getDashboardSummary()` with `error`/`refetch` and the error branch before the loading branch.
- Cards row becomes the three-tile layout fed by the new summary shape (the visual kit lands in Unit 2; this task only fixes data):

```tsx
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          label={copy.dashboard.cards.totalUsers}
          value={data.total_users}
          subline={
            data.suspended_users > 0
              ? copy.dashboard.cards.suspendedSubline(data.suspended_users)
              : copy.dashboard.cards.allActive
          }
        />
        <Card
          label={copy.dashboard.cards.pendingInvitations}
          value={data.pending_invitations}
          subline={
            data.soonest_pending_expiry
              ? copy.dashboard.cards.expirySubline(formatRelative(data.soonest_pending_expiry))
              : copy.dashboard.cards.nonePending
          }
        />
        <Card
          label={copy.dashboard.cards.events24h}
          value={data.events_24h}
          subline={copy.dashboard.cards.events24hSubline}
        />
      </div>
```

with `Card` extended:

```tsx
function Card({ label, value, subline }: { label: string; value: number; subline: string }) {
  return (
    <div className="rounded-md bg-[var(--color-mantle)] p-4">
      <div className="text-sm text-[var(--color-subtext-0)]">{label}</div>
      <div className="text-3xl">{value}</div>
      <div className="text-xs text-[var(--color-subtext-0)]">{subline}</div>
    </div>
  );
}
```

- Recent-activity items switch to the enriched fields:

```tsx
                <div className="text-xs text-[var(--color-subtext-0)]">
                  {e.actor_username ?? '—'}
                  {e.user_username ? ` → ${e.user_username}` : ''}
                </div>
```

and `formatRelative(e.created_at)` replaces `formatRelative(e.timestamp)`.

- Copy: under `dashboard.cards` remove `suspendedUsers` if now unused and add:

```ts
      events24h: 'Audit events',
      events24hSubline: 'in the last 24 hours',
      allActive: 'all active',
      suspendedSubline: (n: number) => `${n} suspended`,
      expirySubline: (rel: string) => `oldest pending expires ${rel}`,
      nonePending: 'none pending',
```

- [ ] **Step 2: Typecheck, test, commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: green.

```bash
git add apps/admin-client/src/routes/dashboard/index.tsx apps/admin-client/src/copy.ts
git commit -m "Compose the dashboard from live endpoint totals"
```

---

### Task 12: Delete the mock layer and the mode switch

**Files:**
- Delete: `apps/admin-client/src/data/admin-api.mock.ts`, `apps/admin-client/src/data/admin-api.hybrid.ts`, `apps/admin-client/src/data/admin-api.live.ts`, `apps/admin-client/src/data/mock-fixtures.ts`, `apps/admin-client/src/data/admin-api.ts`, `apps/admin-client/tests/unit/admin-api.mock.test.ts`
- Modify: `apps/admin-client/src/data/index.ts`, `apps/admin-client/src/env.ts`, `apps/admin-client/.env`, `apps/admin-client/.env.example`

**Interfaces:**
- Produces: `src/data/index.ts` re-exports the live module — `export * from './api.js'; export * from './types.js';` — nothing else. No route may import `getAdminApi` or `data/admin-api.js` any more.

- [ ] **Step 1: Verify no remaining consumers, then delete**

Run: `rg -l "getAdminApi|admin-api|mock-fixtures" apps/admin-client/src apps/admin-client/tests`
Expected: only `src/data/index.ts` and the files being deleted. If any route still matches, fix it first (Tasks 6–11 missed a spot).

```bash
git rm apps/admin-client/src/data/admin-api.mock.ts apps/admin-client/src/data/admin-api.hybrid.ts apps/admin-client/src/data/admin-api.live.ts apps/admin-client/src/data/mock-fixtures.ts apps/admin-client/src/data/admin-api.ts apps/admin-client/tests/unit/admin-api.mock.test.ts
```

- [ ] **Step 2: Rewrite the barrel and the env schema**

`apps/admin-client/src/data/index.ts` becomes:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

export * from './api.js';
export * from './types.js';
```

In `apps/admin-client/src/env.ts`, delete the `VITE_ADMIN_API_MODE` entry from the schema. Remove the `VITE_ADMIN_API_MODE=` lines from `apps/admin-client/.env` and `apps/admin-client/.env.example` (check both exist first: `ls apps/admin-client/.env*`). Search for stray references: `rg -n "ADMIN_API_MODE" apps/ infra/ obsidian/ README.md` — remove any doc mention in the admin-client README if present.

- [ ] **Step 3: Full client gate**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`
Expected: green — the deleted mock test is gone, everything else passes.

- [ ] **Step 4: Commit**

```bash
git add -A apps/admin-client
git commit -m "Delete the admin-client mock data layer and mode switch"
```

---

### Task 13: Unit 1 gate

**Files:** none (verification only).

- [ ] **Step 1: Repo-wide gates**

Run at repo root, in order:

1. `pnpm typecheck --force` → expected **14 successful, 14 total**
2. `pnpm run build` → expected success
3. `cd apps/auth-service && bun test --env-file=../../.env.dev` → no failures beyond the documented pre-existing baseline (compare against a master run if unsure)
4. `cd apps/admin-client && pnpm vitest run` → all pass

- [ ] **Step 2: Biome check on the changed files**

Run: `pnpm biome check apps/admin-client apps/auth-service/src packages/shared-types/src` (adjust to the repo's Biome invocation if it differs — see `package.json` scripts).
Expected: clean.

- [ ] **Step 3: Commit anything the gate shook loose**

If fixes were needed, commit them: `git commit -m "Fix gate findings for the live-wiring unit"`.

---

## Unit 2 — Retrofuturistic control-panel design (Tasks 14–19)

Design contract: spec §7. Base = cassette-futurism (panels, bezels, LEDs, numbered section labels); CRT accents in exactly three places (audit-feed header scanlines + prompt, stat-number glow, LED glow); synthwave dose on the login screen only. Dark-only Mocha.

### Task 14: Fonts + Mocha-only tokens

**Files:**
- Modify: `apps/admin-client/package.json` (two Fontsource deps)
- Modify: `apps/admin-client/src/main.tsx` (font imports)
- Modify: `apps/admin-client/src/index.css`

- [ ] **Step 1: Install fonts**

Run: `cd apps/admin-client && pnpm add @fontsource/space-grotesk @fontsource/jetbrains-mono`

In `src/main.tsx`, add at the very top (before other imports):

```tsx
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
```

- [ ] **Step 2: Rewrite `src/index.css`**

Replace the whole file:

```css
@import "tailwindcss";

@theme {
  /* Catppuccin Mocha — the console is dark-only (spec §7, ADR pending). */
  --color-base: #1e1e2e;
  --color-mantle: #181825;
  --color-crust: #11111b;
  --color-surface-0: #313244;
  --color-surface-1: #45475a;
  --color-text: #cdd6f4;
  --color-subtext-0: #a6adc8;
  --color-overlay-0: #6c7086;
  --color-mauve: #cba6f7;
  --color-red: #f38ba8;
  --color-green: #a6e3a1;
  --color-yellow: #f9e2af;
  --color-peach: #fab387;
  --color-teal: #94e2d5;
  --color-blue: #89b4fa;
  --color-sapphire: #74c7ec;
  --color-lavender: #b4befe;

  --font-sans: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

:root {
  font-family: var(--font-sans);
  color-scheme: dark;
}

body {
  background: var(--color-base);
  color: var(--color-text);
}

/* CRT accent: scanline texture for panel headers that ask for it (spec §7.3). */
.scanlines {
  position: relative;
  overflow: hidden;
}
.scanlines::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    rgb(0 0 0 / 0.35) 0 1px,
    transparent 1px 3px
  );
}
```

Note: the Latte block is gone entirely — that is the point, not an oversight.

- [ ] **Step 3: Visual smoke + gate**

Run: `cd apps/admin-client && pnpm typecheck && pnpm run build`
Expected: green. (Fonts resolve at build time; a broken import fails the build.)

- [ ] **Step 4: Commit**

```bash
git add apps/admin-client/package.json pnpm-lock.yaml apps/admin-client/src/main.tsx apps/admin-client/src/index.css
git commit -m "Bundle console fonts and lock the admin theme to Mocha dark"
```

---

### Task 15: Console component kit

**Files:**
- Create: `apps/admin-client/src/components/console.tsx` (one focused file — the kit is small and changes together)

**Interfaces:**
- Produces (used by Tasks 16–18):

```tsx
export function Panel(props: { header?: ReactNode; led?: LedTone; children: ReactNode; scanlineHeader?: boolean; className?: string }): JSX.Element
export function StatTile(props: { index: string; label: string; value: ReactNode; subline?: string; accent: 'mauve' | 'peach' | 'teal' }): JSX.Element
export function SectionLabel(props: { children: ReactNode }): JSX.Element
export function StatusLed(props: { tone: LedTone }): JSX.Element
export function ConsoleChip(props: { children: ReactNode; tone?: 'green' | 'neutral' }): JSX.Element
export function SkeletonPanel(props: { lines?: number }): JSX.Element
export type LedTone = 'green' | 'yellow' | 'red'
```

- [ ] **Step 1: Implement the kit**

Create `apps/admin-client/src/components/console.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

// The control-panel kit (spec §7.2). Glow is budgeted: LEDs, stat values and
// the audit prompt only — nothing else in the app may add text-shadow glows.

import type { ReactNode } from 'react';

export type LedTone = 'green' | 'yellow' | 'red';

const LED_COLOUR: Record<LedTone, string> = {
  green: 'var(--color-green)',
  yellow: 'var(--color-yellow)',
  red: 'var(--color-red)',
};

export function StatusLed({ tone }: { tone: LedTone }) {
  const colour = LED_COLOUR[tone];
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: colour, boxShadow: `0 0 6px ${colour}` }}
    />
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-overlay-0)]">
      {children}
    </span>
  );
}

export function ConsoleChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'green' | 'neutral';
}) {
  const text = tone === 'green' ? 'text-[var(--color-green)]' : 'text-[var(--color-overlay-0)]';
  return (
    <span
      className={`rounded border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-2 py-0.5 font-mono text-[10px] ${text}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  header,
  led,
  scanlineHeader = false,
  className = '',
  children,
}: {
  header?: ReactNode;
  led?: LedTone;
  scanlineHeader?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-lg border border-[var(--color-surface-0)] bg-[var(--color-mantle)] ${className}`}
    >
      {header !== undefined && (
        <div
          className={`flex items-center gap-2 border-b border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-2 ${scanlineHeader ? 'scanlines' : ''}`}
        >
          {led && <StatusLed tone={led} />}
          <SectionLabel>{header}</SectionLabel>
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

const ACCENT_COLOUR: Record<'mauve' | 'peach' | 'teal', string> = {
  mauve: 'var(--color-mauve)',
  peach: 'var(--color-peach)',
  teal: 'var(--color-teal)',
};

export function StatTile({
  index,
  label,
  value,
  subline,
  accent,
}: {
  index: string;
  label: string;
  value: ReactNode;
  subline?: string;
  accent: 'mauve' | 'peach' | 'teal';
}) {
  const colour = ACCENT_COLOUR[accent];
  return (
    <div
      className="rounded-lg border border-[var(--color-surface-0)] bg-[var(--color-mantle)] p-4"
      style={{ borderTop: `3px solid ${colour}` }}
    >
      <SectionLabel>
        {index} · {label}
      </SectionLabel>
      <div
        className="mt-1 font-mono text-3xl"
        style={{ textShadow: `0 0 10px color-mix(in srgb, ${colour} 35%, transparent)` }}
      >
        {value}
      </div>
      {subline && <div className="mt-1 text-xs text-[var(--color-subtext-0)]">{subline}</div>}
    </div>
  );
}

export function SkeletonPanel({ lines = 3 }: { lines?: number }) {
  return (
    <div className="animate-pulse space-y-2 rounded-lg border border-[var(--color-surface-0)] bg-[var(--color-mantle)] p-4">
      {Array.from({ length: lines }, (_, i) => (
        <div
          // Static list; index keys are fine.
          key={i}
          className="h-3 rounded bg-[var(--color-surface-0)]"
          style={{ width: `${90 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Gate + commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm run build`
Expected: green.

```bash
git add apps/admin-client/src/components/console.tsx
git commit -m "Add the control-panel component kit"
```

---

### Task 16: Root layout + login restyle

**Files:**
- Modify: `apps/admin-client/src/routes/root.tsx`
- Modify: `apps/admin-client/src/routes/login/index.tsx`
- Modify: `apps/admin-client/src/copy.ts`

- [ ] **Step 1: Root layout — header bar + numbered tab nav**

Rewrite the `RootLayout` JSX in `routes/root.tsx` (logic — session, signOut, StepUpModalHost — unchanged):

```tsx
  return (
    <div className="min-h-dvh">
      <StepUpModalHost />
      <header className="border-b border-[var(--color-surface-0)] bg-[var(--color-mantle)] px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <StatusLed tone="green" />
          <span className="text-sm font-bold tracking-[0.25em]">
            CHATSUNDERE <span className="text-[var(--color-overlay-0)]">//</span>{' '}
            <span className="text-[var(--color-mauve)]">ADMIN CONSOLE</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ConsoleChip tone="green">{copy.sysNominal}</ConsoleChip>
            {session?.username && session?.role && (
              <ConsoleChip>{`${session.username} · ${session.role}`}</ConsoleChip>
            )}
            {session?.userId && (
              <button
                type="button"
                onClick={signOut}
                className="rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-1 font-mono text-xs"
              >
                {copy.signOut}
              </button>
            )}
          </div>
        </div>
        <nav className="mx-auto mt-3 flex max-w-5xl gap-1 overflow-x-auto font-mono text-xs">
          {NAV_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                isActive
                  ? 'rounded-t border border-b-2 border-[var(--color-surface-1)] border-b-[var(--color-mauve)] bg-[var(--color-crust)] px-3 py-1.5'
                  : 'border-b border-[var(--color-surface-0)] px-3 py-1.5 text-[var(--color-overlay-0)]'
              }
            >
              {tab.index} {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
```

with above the component (labels from copy):

```tsx
const NAV_TABS = [
  { to: '/dashboard', index: '01', label: copy.nav.dashboard },
  { to: '/users', index: '02', label: copy.nav.users },
  { to: '/invitations', index: '03', label: copy.nav.invitations },
  { to: '/audit', index: '04', label: copy.nav.audit },
];
```

Imports: `import { ConsoleChip, StatusLed } from '../components/console.js';`. Copy addition (top level): `sysNominal: 'SYS NOMINAL'`. If `session.username`/`session.role` are not present on the session store type, fall back to the existing truncated `userId` chip — check `@chatsundere/ui-shared`'s session type first (`rg -n "username" packages/ui-shared/src` — adapt to what exists; do not invent fields).

- [ ] **Step 2: Login — the synthwave dose**

In `routes/login/index.tsx`, restyle the page wrapper and card **without touching the decision-tree logic or form handlers** (spec §7.4):

- Page wrapper: `min-h-dvh` flex-centred over `background: linear-gradient(180deg, #11111b 0%, #181825 60%, #24243a 100%)` (inline style on the wrapper div), `position: relative; overflow: hidden`.
- Neon grid horizon, absolutely positioned at the bottom of the wrapper:

```tsx
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{
          background:
            'repeating-linear-gradient(90deg, rgb(203 166 247 / 0.13) 0 1px, transparent 1px 26px), repeating-linear-gradient(0deg, rgb(203 166 247 / 0.13) 0 1px, transparent 1px 13px)',
          transform: 'perspective(90px) rotateX(50deg)',
          transformOrigin: 'bottom',
        }}
      />
```

- The card: `w-full max-w-sm rounded-xl border p-6` with inline style `borderColor: 'rgb(203 166 247 / 0.5)', background: 'rgb(24 24 37 / 0.92)', boxShadow: '0 0 24px rgb(203 166 247 / 0.22)'`.
- Wordmark inside the card, above the form:

```tsx
        <h1
          className="text-xl font-extrabold tracking-[0.25em]"
          style={{
            background: 'linear-gradient(90deg, var(--color-mauve), var(--color-sapphire))',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {copy.login.wordmark}
        </h1>
        <p className="mb-4 font-mono text-xs text-[var(--color-overlay-0)]">{copy.login.tagline}</p>
```

- Inputs get `font-mono` + `bg-[var(--color-crust)]`; the primary button gets `bg-[var(--color-mauve)] text-[var(--color-crust)] font-bold tracking-[0.15em]` and inline `boxShadow: '0 0 14px rgb(203 166 247 / 0.45)'`.
- Copy additions under `login`: `wordmark: 'ADMIN CONSOLE'`, `tagline: 'chatsundere · operator access'`. Keep every existing error/notice string.

- [ ] **Step 3: Gate + commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run` (the login decision-tree test must stay green — restyle only).

```bash
git add apps/admin-client/src/routes/root.tsx apps/admin-client/src/routes/login/index.tsx apps/admin-client/src/copy.ts
git commit -m "Restyle the console shell and give the login screen its synthwave moment"
```

---

### Task 17: Dashboard + users restyle

**Files:**
- Modify: `apps/admin-client/src/routes/dashboard/index.tsx`
- Modify: `apps/admin-client/src/routes/users/index.tsx`
- Modify: `apps/admin-client/src/routes/users/detail.tsx`

- [ ] **Step 1: Dashboard**

- Replace the local `Card` with `StatTile` (indices/accents: `01`/mauve users, `02`/peach invitations, `03`/teal audit; labels unchanged from Task 11).
- Wrap recent activity in `Panel` with `header={copy.dashboard.recentActivity}`, `led="yellow"`, `scanlineHeader` and add the prompt on the right side of the header — extend `Panel` usage by placing the prompt inside the header node:

```tsx
        <Panel
          led="yellow"
          scanlineHeader
          header={
            <span className="flex w-full items-center justify-between">
              {copy.dashboard.recentActivity}
              <span
                className="font-mono text-[10px] normal-case tracking-normal text-[var(--color-green)]"
                style={{ textShadow: '0 0 6px rgb(166 227 161 / 0.6)' }}
              >
                {'> tail --live ▎'}
              </span>
            </span>
          }
        >
```

- Feed rows: mono font, an inline `StatusLed` per row (tone: `red` for `security` category or `auth.login.failed`, `yellow` for `auth.step_up.*`, otherwise `green`), event type + actor/user usernames + relative time.
- Loading state: `if (!data) return <SkeletonPanel lines={5} />` (after the error branch).

- [ ] **Step 2: Users list + detail**

- List: wrap the table in `Panel` (`header={copy.users.title}` stays as the h1 — keep the h1, wrap only the table), give the table `font-mono text-sm` on data cells and `SectionLabel`-styled headers (`text-[10px] uppercase tracking-[0.2em]`), row borders `border-[var(--color-surface-0)]`, row hover `hover:bg-[var(--color-crust)]`. Status cell becomes a chip: `<ConsoleChip tone={u.status === 'active' ? 'green' : 'neutral'}>{u.status}</ConsoleChip>`. Loading state: `SkeletonPanel lines={6}`. Wrap the table in `<div className="overflow-x-auto">` so 380 px scrolls horizontally.
- Detail: the aside becomes a `Panel` with `header={copy.userDetail.profile}` (copy addition under `userDetail`: `profile: 'Operator file'`), the auth-methods block a second `Panel` (`header={copy.userDetail.authMethods}`), actions a third (`header={copy.userDetail.actionsHeader}`, copy addition: `actionsHeader: 'Actions'`, `led="yellow"`). The `dl` values get `font-mono`. Loading: `SkeletonPanel`.

- [ ] **Step 3: Gate + commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`

```bash
git add apps/admin-client/src/routes/dashboard/index.tsx apps/admin-client/src/routes/users apps/admin-client/src/copy.ts
git commit -m "Restyle dashboard and user screens with the control-panel kit"
```

---

### Task 18: Invitations + audit restyle

**Files:**
- Modify: `apps/admin-client/src/routes/invitations/index.tsx`, `create-modal.tsx`, `reveal-screen.tsx`
- Modify: `apps/admin-client/src/routes/audit/index.tsx`

- [ ] **Step 1: Invitations**

- List: same table treatment as users (Panel wrap, mono data cells, chip for `status` — `green` for pending, neutral otherwise, header labels, overflow-x wrapper, `SkeletonPanel` loading).
- Create modal + reveal dialog: `rounded-xl border border-[var(--color-surface-0)] bg-[var(--color-mantle)]` with a `SectionLabel`-style heading treatment; inputs `bg-[var(--color-crust)] font-mono`; primary buttons mauve-filled; the reveal warning line keeps `--color-yellow` and gains a leading `StatusLed tone="yellow"`; the bare code line stays `font-mono text-2xl tracking-[0.3em]`.

- [ ] **Step 2: Audit screen**

- Filter row: inputs/selects `bg-[var(--color-crust)] font-mono text-sm border-[var(--color-surface-0)]`.
- Table: Panel wrap with `scanlineHeader` + the `> tail --live ▎` prompt (same header node pattern as Task 17 step 1), category badge cell keeps its pill, `security`-category rows get a `StatusLed tone="red"` before the badge; expanded metadata `<pre>` gets `bg-[var(--color-crust)] border border-[var(--color-surface-0)]`.
- Loading: `SkeletonPanel lines={8}`.

- [ ] **Step 3: Gate + commit**

Run: `cd apps/admin-client && pnpm typecheck && pnpm vitest run`

```bash
git add apps/admin-client/src/routes/invitations apps/admin-client/src/routes/audit
git commit -m "Restyle invitations and audit screens with the control-panel kit"
```

---

### Task 19: Process artefacts + final gate

**Files:**
- Modify: `CLAUDE.md` (§11, one line)
- Create: `obsidian/decisions/00XX-retrofuturistic-admin-console.md` (next free number — check `ls obsidian/decisions/ | sort | tail -3`)
- Modify: `obsidian/insights/follow-ups-index.md` (one entry)
- Modify: `obsidian/STATUS-BACKEND.md`

- [ ] **Step 1: CLAUDE.md §11**

Replace the line `- **Admin styling:** Catppuccin — functional, not opulent.` with:

```markdown
- **Admin styling:** Catppuccin Mocha retrofuturistic control panel — dark-only, functional first, flavour budgeted. See the ADR in `obsidian/decisions/`.
```

- [ ] **Step 2: ADR**

Create the ADR (Michael Nygard style, matching neighbours in `obsidian/decisions/` — read one for the exact template), covering: context (wireframe admin, Chris's direction), decision (cassette-futurism base + CRT accents + login synthwave dose; Mocha dark-only; desktop-optimised with 380 px usability floor), consequences (Latte removed; glow budget as a hard styling rule; conscious deviation from the user-client's mobile-first rule; CLAUDE.md §11 revised). Status: Accepted, date 2026-07-05.

- [ ] **Step 3: Follow-ups entry**

Append to `obsidian/insights/follow-ups-index.md` (match the file's existing entry format):

```markdown
- Role change / transfer-primary do not deny-list still-valid access tokens; the old
  role claim survives until token expiry (only suspension writes the deny-list).
  Candidate hardening: write denySub on role transitions. Source: admin live-wiring
  spec §10 (2026-07-04).
```

- [ ] **Step 4: STATUS-BACKEND.md**

Update the header block: date, one paragraph — admin-client wired live (mock deleted), audit enriched server-side (usernames + DESC + users-list total/filters), change-role + transfer-primary + invitation fields landed, control-panel restyle done, Larissa audit of Unit 1 owed (worker cannot summon her), Chris's spec-§11 manual verification owed.

- [ ] **Step 5: Final full gate**

1. `pnpm typecheck --force` → **14 successful, 14 total**
2. `pnpm run build` → success
3. `cd apps/auth-service && bun test --env-file=../../.env.dev` → baseline-clean
4. `cd apps/admin-client && pnpm vitest run` → all pass

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md obsidian/decisions obsidian/insights/follow-ups-index.md obsidian/STATUS-BACKEND.md
git commit -m "Record the control-panel design decision and update status"
```

---

## Post-run (Liz, not the worker)

1. Larissa audits the Unit 1 diff (auth-service + shared-types + data layer) with absolute worktree paths.
2. Chris runs spec §11 manual verification on the dev stack.
3. Squash into the two feature units (Tasks 1–13 → "Wire admin-client to live backend"; Tasks 14–19 → "Restyle admin console as retrofuturistic control panel"), verify the squash captured the full tree, then integrate.
4. Merge-order note: the trashcan overnight run also branches from `full-backend-transition`; the only shared file risk is `packages/shared-types/src/index.ts` (this plan does not touch it) — expect a clean merge, verify anyway.
