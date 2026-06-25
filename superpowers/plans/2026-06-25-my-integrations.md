# My Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/app/integrations` (MCP servers — add/edit/delete) in the makeover design language as a two-tier list → detail page tree, porting the existing MCP logic verbatim and adding a shared detail-page dirty-guard.

**Architecture:** Mirror the AI Providers tree (`settings/providers.tsx` list + `settings/provider.tsx` detail). The list page becomes a `PageScaffold` of pure-navigation rows; the bottom-sheet `McpServerSheet` overlay becomes a `PageScaffold` detail page (`IntegrationServerPage`) split into an outer data-loading/guard shell and an inner form that seeds its fields from the already-loaded row (avoids the async-seed data-loss bug). A reusable dirty-guard is added to `PageScaffold`/`PageBar` and adopted by both this detail page and the AI Providers detail page.

**Tech Stack:** TypeScript (strict), React 18 + Vite, React Router v6, TanStack Query, Tailwind v4, Vitest + Testing Library.

## Global Constraints

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` without an inline comment.
- Biome bans the non-null assertion `!`. Never write `x!`. Use explicit guards / `?.` / `?? `.
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`.
- **British English** everywhere (code, comments, copy, test names): `behaviour`, `colour`, `initialise`.
- **No Dexie / schema change.** The `McpServerRow` shape is consumed unchanged.
- Package-public functions carry a one-line JSDoc.
- Gate per task: `pnpm --filter @chatsundere/user-client test <file>` for the touched test; final gate `pnpm typecheck --force` (run from repo root, expect 14/14) + full user-client vitest at the **8 Node-localStorage baseline** (a 9th failure is real).
- Commit after each task (free-form imperative subject, capitalised). Co-author trailer: `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`. Code commits do **not** get `[skip ci]`.
- Subagents never merge, push, or switch branches.

---

### Task 1: Shared dirty-guard seam in PageScaffold / PageBar

Adds an opt-in navigation guard to the shared page chrome. Backward-compatible: pages that pass no `dirty` behave exactly as today.

**Files:**
- Modify: `apps/user-client/src/components/ui/PageBar.tsx`
- Modify: `apps/user-client/src/components/ui/PageScaffold.tsx`
- Test: `apps/user-client/tests/component/page-scaffold-dirty-guard.test.tsx` (create)

**Interfaces:**
- Produces: `PageBarProps.onNavigate?: (to: string) => void`; `PageScaffoldProps.dirty?: boolean`.
- Consumes: `ConfirmDialog` (`components/ui/ConfirmDialog.js`), `useNavigate` (react-router-dom).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/page-scaffold-dirty-guard.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PageScaffold } from '../../src/components/ui/PageScaffold.js';

afterEach(cleanup);

function wrap(dirty: boolean) {
  return render(
    <MemoryRouter initialEntries={['/page']}>
      <Routes>
        <Route
          path="/page"
          element={
            <PageScaffold
              crumbs={[{ label: 'Parent', to: '/home' }, { label: 'Page' }]}
              back="/home"
              dirty={dirty}
            >
              <div>page body</div>
            </PageScaffold>
          }
        />
        <Route path="/home" element={<div>home screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PageScaffold dirty-guard', () => {
  it('navigates immediately on Back when not dirty', () => {
    wrap(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('home screen')).toBeInTheDocument();
  });

  it('intercepts Back with a discard dialog when dirty', () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(screen.queryByText('home screen')).not.toBeInTheDocument();
  });

  it('"Keep editing" dismisses and stays on the page', () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('"Discard" leaves the page', () => {
    wrap(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(screen.getByText('home screen')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/page-scaffold-dirty-guard.test.tsx`
Expected: FAIL — `PageScaffold` does not accept `dirty`; clicking Back navigates with no dialog.

- [ ] **Step 3: Add the `onNavigate` seam to PageBar**

In `apps/user-client/src/components/ui/PageBar.tsx`, add the prop to the interface (after `onHelp`):

```tsx
  /** Optional navigation interceptor. When given, the back control and ancestor
   *  crumbs call this instead of navigating directly, so a parent can guard
   *  unsaved changes. The `?` help affordance is unaffected. */
  onNavigate?: (to: string) => void;
```

Change the function signature to `export function PageBar({ crumbs, back, onHelp, onNavigate }: PageBarProps): JSX.Element {` and, right after `const navigate = useNavigate();`, add:

```tsx
  const go = onNavigate ?? navigate;
```

Replace the back button `onClick={() => navigate(back)}` with `onClick={() => go(back)}`, and the crumb button `onClick={() => navigate(c.to as string)}` with `onClick={() => go(c.to as string)}`.

- [ ] **Step 4: Add the `dirty` guard to PageScaffold**

Replace the whole body of `apps/user-client/src/components/ui/PageScaffold.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog.js';
import { type Crumb, PageBar } from './PageBar.js';

export interface PageScaffoldProps {
  crumbs: Crumb[];
  back: string;
  onHelp?: (el: HTMLElement) => void;
  /** When true, leaving via the PageBar back control or an ancestor crumb first
   *  prompts a discard-changes confirm. Omit (or false) for the plain
   *  pass-through used by every always-save page. */
  dirty?: boolean;
  /** The scrolling page content; the PageBar above it stays put. */
  children: ReactNode;
}

/**
 * Standard page layout (spec §2.4): a sticky PageBar plus a scrolling content
 * region. When `dirty` is set, the bar's back/crumb navigation is intercepted by
 * a discard-changes confirm so unsaved input is never lost silently.
 */
export function PageScaffold({ crumbs, back, onHelp, dirty, children }: PageScaffoldProps): JSX.Element {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const onNavigate = dirty ? (to: string) => setPending(to) : undefined;

  return (
    <div className="cs-page">
      <PageBar crumbs={crumbs} back={back} onHelp={onHelp} onNavigate={onNavigate} />
      <div className="cs-page-body">{children}</div>
      <ConfirmDialog
        open={pending !== null}
        title="Discard unsaved changes?"
        body="Your changes haven't been saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const to = pending;
          setPending(null);
          if (to !== null) navigate(to);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/page-scaffold-dirty-guard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/ui/PageBar.tsx apps/user-client/src/components/ui/PageScaffold.tsx apps/user-client/tests/component/page-scaffold-dirty-guard.test.tsx
git commit -m "Add opt-in dirty-guard to PageScaffold/PageBar

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 2: `integrations` help content

The `?` on all three Integrations routes opens this. Must exist before the pages ship (a `?` that opens nothing is a dead affordance — Laura SOFT-4).

**Files:**
- Create: `apps/user-client/src/content/help/integrations.md`
- Modify: `apps/user-client/src/content/help/index.ts`
- Test: `apps/user-client/tests/unit/help-integrations.test.ts` (create)

**Interfaces:**
- Produces: `HelpKey` gains the `'integrations'` member; `HELP_DOCS['integrations']` resolves to `{ title, markdown }`.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/unit/help-integrations.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { HELP_DOCS } from '../../src/content/help/index.js';

describe('integrations help', () => {
  it('registers a non-empty Integrations help doc', () => {
    const doc = HELP_DOCS.integrations;
    expect(doc).toBeDefined();
    expect(doc.title).toMatch(/integrations/i);
    expect(doc.markdown.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/unit/help-integrations.test.ts`
Expected: FAIL — `HELP_DOCS.integrations` is undefined (and the type has no such key).

- [ ] **Step 3: Author the help doc**

Create `apps/user-client/src/content/help/integrations.md`:

```markdown
# My Integrations

Integrations connect your Circle to tools that live outside Chatsundere. Today
that means **MCP servers** — small services that expose tools (search a wiki,
query a database, control your homelab) a persona can call mid-conversation.

## Adding a server

Tap **Add MCP server**, give it a name and its URL, and — if it needs one — an
authentication key. Tap **Test connection** to check it answers and to see the
tools it offers. When you are happy, tap **Save**.

## How a call reaches the server

By default the request travels through your configured CORS proxy. If the server
is on your own network and allows direct browser access, turn on **Local
network** to connect straight to it instead.

## Trust and approval

Tool calls send their arguments — which may include parts of your conversation —
to the server, so they wait for your approval each time. Mark a server as
**Trusted** to let its tools run without asking. **On by default** decides
whether a server's tools are armed in new chats; you can still override this per
persona.

## Removing a server

Open the server and tap **Remove server**. Its stored key is deleted and your
personas lose access to its tools.
```

- [ ] **Step 4: Register the doc**

In `apps/user-client/src/content/help/index.ts`:

1. Add the import alongside the others (alphabetical by source path is fine):
```ts
import integrations from './integrations.md?raw';
```
2. Add `'integrations'` to the `HelpKey` union (e.g. after `'logout'`):
```ts
  | 'integrations'
```
3. Add the entry to `HELP_DOCS`:
```ts
  integrations: { title: 'My Integrations — help', markdown: integrations },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/unit/help-integrations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/content/help/integrations.md apps/user-client/src/content/help/index.ts apps/user-client/tests/unit/help-integrations.test.ts
git commit -m "Add Integrations help content

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 3: Integration server detail page (`IntegrationServerPage`)

Ports `McpServerSheet`'s logic into a `PageScaffold` detail page covering both add (`/new`) and edit (`/:serverId`) modes. Split into an **outer** shell (loads servers, guards unknown id) and an **inner** form (seeds fields from the already-loaded row, so an async load can't blank an edit form).

**Files:**
- Create: `apps/user-client/src/routes/app/integrations/server.tsx`
- Test: `apps/user-client/tests/component/integration-server.test.tsx` (create)

**Interfaces:**
- Consumes: `PageScaffold` (`dirty` prop from Task 1), `useHelp('integrations')` (Task 2), `useMcpServers`/`useUpsertMcpServer`/`useDeleteMcpServer`/`sealMcpKey`/`openMcpKey` (`data/mcp-servers.js`), `testMcpConnection` (`mcp/mcp-connectivity.js`), `sanitiseToolName` (`mcp/tool-naming.js`), `Badge`, `Button`, `ConfirmDialog`.
- Produces: `export function IntegrationServerPage(): JSX.Element` — used by the App.tsx routes in Task 5.

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/integration-server.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const { useMcpServersMock, upsertMock, deleteMock, testConnMock } = vi.hoisted(() => ({
  useMcpServersMock: vi.fn(() => ({ data: [] as unknown[] })),
  upsertMock: vi.fn(async (row: unknown) => row),
  deleteMock: vi.fn(),
  testConnMock: vi.fn(),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: CryptoKey }) => unknown) => selector({ mk: {} as CryptoKey }),
}));
vi.mock('../../src/data/mcp-servers.js', () => ({
  useMcpServers: () => useMcpServersMock(),
  useUpsertMcpServer: () => ({ mutate: vi.fn(), mutateAsync: upsertMock }),
  useDeleteMcpServer: () => ({ mutate: deleteMock }),
  sealMcpKey: vi.fn(async () => ({ blob: 'sealed' })),
  openMcpKey: vi.fn(async () => 'plain'),
}));
vi.mock('../../src/data/settings.js', () => ({ useSettings: () => ({ data: { corsProxy: null } }) }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));
vi.mock('../../src/lib/secrets.js', () => ({
  openSecret: vi.fn(async () => 'plain'),
  sealSecret: vi.fn(async () => ({ blob: 'sealed' })),
}));
vi.mock('../../src/mcp/mcp-connectivity.js', () => ({ testMcpConnection: (a: unknown) => testConnMock(a) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { IntegrationServerPage } from '../../src/routes/app/integrations/server.js';

const ROW: McpServerRow = {
  id: 's1',
  name: 'Wiki tools',
  url: 'https://wiki.example/mcp',
  prefix: 'wiki',
  auth: null,
  onByDefault: false,
  autoRun: false,
  allowDirect: false,
  enabled: true,
  routing: null,
  resolvedEndpoint: null,
  tools: [],
  hiddenTools: [],
  lastTestedAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

function wrapAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/integrations/new" element={<IntegrationServerPage />} />
          <Route path="/app/integrations/:serverId" element={<IntegrationServerPage />} />
          <Route path="/app/integrations" element={<div>integrations list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IntegrationServerPage', () => {
  beforeEach(() => {
    cleanup();
    useMcpServersMock.mockReturnValue({ data: [] });
  });

  it('renders empty Name/URL fields and a Save action in add mode', () => {
    wrapAt('/app/integrations/new');
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('URL')).toHaveValue('');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('seeds the form from an existing row in edit mode', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrapAt('/app/integrations/s1');
    expect(screen.getByLabelText('Name')).toHaveValue('Wiki tools');
    expect(screen.getByLabelText('URL')).toHaveValue('https://wiki.example/mcp');
  });

  it('shows a calm notice for an unknown server id', () => {
    useMcpServersMock.mockReturnValue({ data: [] });
    wrapAt('/app/integrations/does-not-exist');
    expect(screen.getByText(/no longer here/i)).toBeInTheDocument();
  });

  it('disables Test connection until a URL is present', () => {
    wrapAt('/app/integrations/new');
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://x/mcp' } });
    expect(screen.getByRole('button', { name: /test connection/i })).toBeEnabled();
  });

  it('marks the form dirty (Unsaved badge) once a field changes', () => {
    wrapAt('/app/integrations/new');
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } });
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });

  it('opens a remove confirm and deletes on confirm', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrapAt('/app/integrations/s1');
    fireEvent.click(screen.getByRole('button', { name: /remove server/i }));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(deleteMock).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/integration-server.test.tsx`
Expected: FAIL — `../../src/routes/app/integrations/server.js` does not exist.

- [ ] **Step 3: Create the detail page**

Create `apps/user-client/src/routes/app/integrations/server.tsx` with this exact content:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import type { McpServerRow } from '../../../boot/client-data-db.js';
import { Badge } from '../../../components/ui/Badge.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import {
  openMcpKey,
  sealMcpKey,
  useDeleteMcpServer,
  useMcpServers,
  useUpsertMcpServer,
} from '../../../data/mcp-servers.js';
import { useSettings } from '../../../data/settings.js';
import { openSecret } from '../../../lib/secrets.js';
import { testMcpConnection } from '../../../mcp/mcp-connectivity.js';
import { sanitiseToolName } from '../../../mcp/tool-naming.js';
import type { McpAuthResolved, McpToolDefinition } from '../../../mcp/types.js';

type AuthScheme = 'none' | 'bearer' | 'header';
type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'done' };

const CRUMB_ROOT = { label: 'My Integrations', to: '/app/integrations' } as const;
const inputClass =
  'w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none';

/**
 * Outer shell: resolves the route, loads the servers, and guards the
 * unknown-id case before the inner form seeds its fields. Keeping the data load
 * out here means the form below only mounts once the row is in hand, so an async
 * load can never blank an edit form.
 */
export function IntegrationServerPage(): JSX.Element {
  const { serverId } = useParams();
  const servers = useMcpServers();
  const { onHelp, helpOverlay } = useHelp('integrations');

  if (serverId && !servers.data) {
    return (
      <PageScaffold crumbs={[CRUMB_ROOT, { label: 'Loading…' }]} back="/app/integrations" onHelp={onHelp}>
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">Loading…</p>
      </PageScaffold>
    );
  }

  const existing = serverId ? servers.data?.find((r) => r.id === serverId) : undefined;

  if (serverId && !existing) {
    return (
      <PageScaffold crumbs={[CRUMB_ROOT, { label: 'Unknown' }]} back="/app/integrations" onHelp={onHelp}>
        {helpOverlay}
        <p className="px-4 pt-4 text-sm text-paper-soft">
          This server is no longer here — go back to My Integrations to pick another.
        </p>
      </PageScaffold>
    );
  }

  return <IntegrationServerForm existing={existing} />;
}

/** Inner form: add (existing undefined) or edit a single MCP server. */
function IntegrationServerForm({ existing }: { existing?: McpServerRow }): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('integrations');
  const navigate = useNavigate();
  const settings = useSettings();
  const upsert = useUpsertMcpServer();
  const del = useDeleteMcpServer();
  const mk = useSessionStore((s) => s.mk);

  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [prefix, setPrefix] = useState(existing?.prefix ?? '');
  const [prefixEdited, setPrefixEdited] = useState(existing != null);
  const [authScheme, setAuthScheme] = useState<AuthScheme>(existing?.auth?.scheme ?? 'none');
  const [headerName, setHeaderName] = useState(
    existing?.auth?.scheme === 'header' ? existing.auth.headerName : '',
  );
  const [keyInput, setKeyInput] = useState('');
  const [onByDefault, setOnByDefault] = useState(existing?.onByDefault ?? false);
  const [autoRun, setAutoRun] = useState(existing?.autoRun ?? false);
  const [allowDirect, setAllowDirect] = useState(existing?.allowDirect ?? false);

  const [routing, setRouting] = useState<McpServerRow['routing']>(existing?.routing ?? null);
  const [resolvedEndpoint, setResolvedEndpoint] = useState<string | null>(
    existing?.resolvedEndpoint ?? null,
  );
  const [tools, setTools] = useState<McpToolDefinition[]>(existing?.tools ?? []);
  const [hiddenTools, setHiddenTools] = useState<string[]>(existing?.hiddenTools ?? []);
  const [lastError, setLastError] = useState<string | null>(existing?.lastError ?? null);
  const [lastTestedAt, setLastTestedAt] = useState<number | null>(existing?.lastTestedAt ?? null);
  const [routingChangedHint, setRoutingChangedHint] = useState(false);

  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const effectivePrefix = prefixEdited ? prefix : sanitiseToolName(name);
  const back = () => navigate('/app/integrations');

  function buildAuth(key: string | null): McpAuthResolved | null {
    if (!key) return null;
    if (authScheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
    if (authScheme === 'header' && headerName) return { header: headerName, value: key };
    return null;
  }

  function clearTestResult() {
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
    setLastTestedAt(null);
    setLastError(null);
    setTest({ kind: 'idle' });
  }

  async function onTest() {
    if (!mk || !url) return;
    setError(null);
    setRoutingChangedHint(false);
    setTest({ kind: 'testing' });
    try {
      const sealedShared = settings.data?.corsProxy?.sharedKey ?? null;
      const hasProxy = settings.data?.corsProxy != null;
      if (!allowDirect && !hasProxy) {
        setLastError(
          'No CORS proxy configured. Turn on Local network to connect directly, or add a proxy in AI provider settings.',
        );
        setTest({ kind: 'done' });
        return;
      }
      const proxyUrl = settings.data?.corsProxy?.url ?? null;
      const decryptedKey =
        hasProxy && sealedShared ? await openSecret(sealedShared, mk, 'cors-proxy/shared-key') : null;
      const corsProxy =
        hasProxy && proxyUrl && decryptedKey ? { url: proxyUrl, key: decryptedKey } : null;

      const plaintextKey =
        authScheme === 'none'
          ? null
          : keyInput
            ? keyInput
            : existing
              ? await openMcpKey(existing, mk)
              : null;
      const auth = buildAuth(plaintextKey);

      const result = await testMcpConnection({ url, hasProxy, allowDirect, corsProxy, auth });

      setRouting(result.routing);
      setResolvedEndpoint(result.resolvedEndpoint);
      setTools(result.tools);
      setLastError(result.error);
      setLastTestedAt(Date.now());
      setTest({ kind: 'done' });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
      setTest({ kind: 'done' });
    }
  }

  function onToggleAllowDirect() {
    setDirty(true);
    setAllowDirect((v) => !v);
    setRoutingChangedHint(routing !== null || resolvedEndpoint !== null);
    setRouting(null);
    setResolvedEndpoint(null);
    setTools([]);
    setLastError(null);
    setLastTestedAt(null);
    setTest({ kind: 'idle' });
  }

  function toggleHidden(toolName: string) {
    setDirty(true);
    setHiddenTools((prev) =>
      prev.includes(toolName) ? prev.filter((n) => n !== toolName) : [...prev, toolName],
    );
  }

  async function onSave() {
    if (!mk) {
      setError('No master key in session — re-login required.');
      return;
    }
    if (!name || !url) {
      setError('Name and URL are required.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const id = existing?.id ?? uuidv7();

      let auth: McpServerRow['auth'] = null;
      if (authScheme === 'bearer') {
        const sealed = keyInput
          ? await sealMcpKey(keyInput, mk, id)
          : existing?.auth?.scheme === 'bearer'
            ? existing.auth.key
            : null;
        auth = sealed ? { scheme: 'bearer', key: sealed } : null;
      } else if (authScheme === 'header') {
        const sealed = keyInput
          ? await sealMcpKey(keyInput, mk, id)
          : existing?.auth?.scheme === 'header'
            ? existing.auth.key
            : null;
        auth = sealed && headerName ? { scheme: 'header', headerName, key: sealed } : null;
      }

      const now = Date.now();
      const row: McpServerRow = {
        id,
        name,
        url,
        prefix: effectivePrefix,
        auth,
        onByDefault,
        autoRun,
        allowDirect,
        enabled: true,
        routing,
        resolvedEndpoint,
        tools,
        hiddenTools,
        lastTestedAt,
        lastError,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await upsert.mutateAsync(row);
      setDirty(false);
      back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageScaffold
      crumbs={[CRUMB_ROOT, { label: existing ? existing.name : 'Add server' }]}
      back="/app/integrations"
      onHelp={onHelp}
      dirty={dirty}
    >
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        <div>
          <label htmlFor="mcp-name" className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">
            Name
          </label>
          <input
            id="mcp-name"
            type="text"
            placeholder="My tool server"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="mcp-url" className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">
            URL
          </label>
          <input
            id="mcp-url"
            type="text"
            placeholder="https://example.com/mcp"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setDirty(true);
              clearTestResult();
            }}
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="mcp-prefix" className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">
            Tool prefix
          </label>
          <input
            id="mcp-prefix"
            type="text"
            placeholder="prefix"
            value={effectivePrefix}
            onChange={(e) => {
              setPrefixEdited(true);
              setPrefix(e.target.value);
              setDirty(true);
            }}
            autoComplete="off"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="mcp-auth" className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">
            Authentication
          </label>
          <select
            id="mcp-auth"
            value={authScheme}
            onChange={(e) => {
              setAuthScheme(e.target.value as AuthScheme);
              setDirty(true);
              clearTestResult();
            }}
            className={inputClass}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
        </div>

        {authScheme === 'header' ? (
          <div>
            <label
              htmlFor="mcp-header-name"
              className="mb-1 block text-xs uppercase tracking-widest text-paper-soft"
            >
              Header name
            </label>
            <input
              id="mcp-header-name"
              type="text"
              placeholder="X-API-Key"
              value={headerName}
              onChange={(e) => {
                setHeaderName(e.target.value);
                setDirty(true);
              }}
              autoComplete="off"
              className={inputClass}
            />
          </div>
        ) : null}

        {authScheme !== 'none' ? (
          <div>
            <label htmlFor="mcp-key" className="mb-1 block text-xs uppercase tracking-widest text-paper-soft">
              Key
            </label>
            <input
              id="mcp-key"
              type="password"
              placeholder={
                existing != null && existing.auth?.scheme === authScheme
                  ? 'leave blank to keep current'
                  : 'token or key'
              }
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setDirty(true);
                clearTestResult();
              }}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              name=""
              className={inputClass}
            />
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-xs text-paper-soft">
          <input
            type="checkbox"
            checked={onByDefault}
            onChange={() => {
              setOnByDefault((v) => !v);
              setDirty(true);
            }}
            aria-label="On by default"
          />
          On by default
        </label>

        <label className="flex items-center gap-2 text-xs text-paper-soft">
          <input
            type="checkbox"
            checked={autoRun}
            onChange={() => {
              setAutoRun((v) => !v);
              setDirty(true);
            }}
            aria-label="Trusted — run tools without approval"
          />
          Trusted — run tools without approval
        </label>

        <label
          className="flex items-center gap-2 text-xs text-paper-soft"
          title="Your browser connects straight to the server, which must allow direct browser access (CORS)."
        >
          <input
            type="checkbox"
            checked={allowDirect}
            onChange={onToggleAllowDirect}
            aria-label="Local network — connect directly (must support CORS)"
          />
          Local network <span className="text-paper-soft/60">(must support CORS)</span>
        </label>

        <Button
          tone="neutral"
          onClick={() => void onTest()}
          disabled={!mk || !url || test.kind === 'testing'}
          title={!mk ? 'Unlock to test' : undefined}
        >
          {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>

        {test.kind === 'done' && lastError ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            ✗ {lastError}
          </div>
        ) : null}

        {test.kind === 'done' && !lastError && routing ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            ● Connected ({routing === 'proxy' ? 'via proxy' : 'direct'}) · {resolvedEndpoint}
          </div>
        ) : null}

        {routingChangedHint && test.kind === 'idle' ? (
          <div className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.06] px-3 py-2 text-xs text-paper-soft">
            Routing changed — re-test the connection.
          </div>
        ) : null}

        {tools.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-paper-soft">
              Tools ({tools.length})
            </div>
            <div className="flex flex-col gap-1">
              {tools.map((tool) => (
                <label
                  key={tool.name}
                  className="flex items-start gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-xs text-paper"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenTools.includes(tool.name)}
                    onChange={() => toggleHidden(tool.name)}
                    aria-label={`Enable tool ${tool.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono">{tool.name}</span>
                    {tool.description ? (
                      <span className="block text-[11px] text-paper-soft">{tool.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            ✗ {error}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button tone="primary" onClick={() => void onSave()} disabled={!mk || saving} title={!mk ? 'Unlock to save' : undefined}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {dirty ? <Badge tone="warning">● Unsaved</Badge> : null}
        </div>

        {existing ? (
          <Button tone="destructive" className="self-start" onClick={() => setConfirmDelete(true)}>
            Remove server
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${existing?.name ?? ''}?`}
        body="The server and its stored key are deleted. Personas lose access to its tools."
        confirmLabel="Remove"
        cancelLabel="Keep"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (existing) {
            del.mutate(existing.id);
            back();
          }
        }}
      />
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/integration-server.test.tsx`
Expected: PASS (6 tests). If the delete test cannot find a single `Remove` button (the destructive trigger reads "Remove server", the dialog confirm reads "Remove"), the `{ name: /^remove$/i }` anchor disambiguates — the dialog confirm is the exact match.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/integrations/server.tsx apps/user-client/tests/component/integration-server.test.tsx
git commit -m "Add IntegrationServerPage detail surface

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 4: Rebuild the Integrations list page

Rewrites `integrations.tsx` from the `EditorSticky`/`AccordionCard` shell into a `PageScaffold` of pure-navigation rows with a `Default: On/Off` badge.

**Files:**
- Modify (rewrite): `apps/user-client/src/routes/app/integrations.tsx`
- Test: `apps/user-client/tests/component/integrations.test.tsx` (create)

**Interfaces:**
- Consumes: `PageScaffold`, `useHelp('integrations')`, `useMcpServers`, `useSettings`, `Badge`.
- Produces: `export function Integrations(): JSX.Element` (unchanged name — App.tsx import stays valid).

- [ ] **Step 1: Write the failing test**

Create `apps/user-client/tests/component/integrations.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

const { useMcpServersMock } = vi.hoisted(() => ({
  useMcpServersMock: vi.fn(() => ({ data: [] as unknown[] })),
}));

vi.mock('../../src/data/mcp-servers.js', () => ({ useMcpServers: () => useMcpServersMock() }));
vi.mock('../../src/data/settings.js', () => ({ useSettings: () => ({ data: { corsProxy: null } }) }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { Integrations } from '../../src/routes/app/integrations.js';

const ROW: McpServerRow = {
  id: 's1',
  name: 'Wiki tools',
  url: 'https://wiki.example/mcp',
  prefix: 'wiki',
  auth: null,
  onByDefault: true,
  autoRun: false,
  allowDirect: false,
  enabled: true,
  routing: 'proxy',
  resolvedEndpoint: 'https://proxy/x',
  tools: [],
  hiddenTools: [],
  lastTestedAt: 1,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
};

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/app/integrations']}>
      <Routes>
        <Route path="/app/integrations" element={<Integrations />} />
        <Route path="/app/integrations/new" element={<div>add server screen</div>} />
        <Route path="/app/integrations/:serverId" element={<div>detail screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Integrations list', () => {
  beforeEach(() => {
    cleanup();
    useMcpServersMock.mockReturnValue({ data: [] });
  });

  it('shows the empty state and an add affordance when there are no servers', () => {
    wrap();
    expect(screen.getByText(/no mcp servers yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add mcp server/i })).toBeInTheDocument();
  });

  it('navigates to the add page from the add button', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /add mcp server/i }));
    expect(screen.getByText('add server screen')).toBeInTheDocument();
  });

  it('renders a server row with its status and a Default badge, and opens its detail', () => {
    useMcpServersMock.mockReturnValue({ data: [ROW] });
    wrap();
    expect(screen.getByText('Wiki tools')).toBeInTheDocument();
    expect(screen.getByText(/needs proxy/i)).toBeInTheDocument();
    expect(screen.getByText('Default: On')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Wiki tools'));
    expect(screen.getByText('detail screen')).toBeInTheDocument();
  });
});
```

Note: the `ROW` has `routing: 'proxy'` with no proxy configured, so `statusOf` returns `✗ Needs proxy` — the `/needs proxy/i` assertion is deterministic.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/integrations.test.tsx`
Expected: FAIL — the current `Integrations` renders the old `AccordionCard`/`McpServersSection`, so there is no `Default: On` badge and the add control is inside the section.

- [ ] **Step 3: Rewrite the list page**

Replace the whole content of `apps/user-client/src/routes/app/integrations.tsx` with:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useNavigate } from 'react-router-dom';
import type { McpServerRow } from '../../boot/client-data-db.js';
import { Badge } from '../../components/ui/Badge.js';
import { PageScaffold } from '../../components/ui/PageScaffold.js';
import { useHelp } from '../../content/help/use-help.js';
import { useMcpServers } from '../../data/mcp-servers.js';
import { useSettings } from '../../data/settings.js';

/** Row status string, ported verbatim from the former McpServersSection. */
function statusOf(row: McpServerRow, hasProxy: boolean): string {
  if (!row.enabled) return '✗ Disabled';
  if (row.routing === null) {
    if (!row.allowDirect && !hasProxy) return '✗ Needs proxy or Local network';
    return '✗ Not tested';
  }
  if (row.routing === 'proxy' && !hasProxy) return '✗ Needs proxy';
  if (row.lastError) return `✗ ${row.lastError}`;
  return row.routing === 'proxy' ? '● Connected (via proxy)' : '● Connected (direct)';
}

/**
 * My Integrations — external service & tool integrations. MCP servers are the
 * first inhabitant; rows are pure navigation into the per-server detail page.
 */
export function Integrations(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('integrations');
  const navigate = useNavigate();
  const servers = useMcpServers();
  const settings = useSettings();

  const rows = servers.data ?? [];
  const hasProxy = settings.data?.corsProxy != null;

  return (
    <PageScaffold crumbs={[{ label: 'My Integrations' }]} back="/app" onHelp={onHelp}>
      {helpOverlay}
      <div className="flex flex-col gap-3 px-4 pb-8 pt-2">
        <p className="rounded-md border border-aurora-500/30 bg-aurora-500/[0.04] p-3 text-[11px] text-paper-soft">
          MCP tools run on external servers. Each call sends its arguments — which may include parts
          of your conversation — to that server. Tools wait for your approval unless you mark a server
          as trusted.
        </p>

        {rows.length === 0 ? (
          <p className="rounded-md border border-white/5 bg-white/[0.02] p-4 text-sm text-paper-soft">
            No MCP servers yet — add one to give your Circle external tools.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => navigate(`/app/integrations/${row.id}`)}
                className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3 text-left hover:bg-white/[0.04]"
              >
                <div className="grid h-10 w-10 place-items-center rounded-md bg-white/5 font-display text-sm text-paper">
                  ⧉
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-sm text-paper">{row.name}</div>
                  <div className="text-xs text-paper-soft">{statusOf(row, hasProxy)}</div>
                </div>
                <Badge tone={row.onByDefault ? 'success' : 'neutral'}>
                  {row.onByDefault ? 'Default: On' : 'Default: Off'}
                </Badge>
                <span className="text-paper-soft">▸</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          aria-label="Add MCP server"
          onClick={() => navigate('/app/integrations/new')}
          className="rounded-md border border-dashed border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-paper-soft hover:border-paper hover:text-paper"
        >
          + Add MCP server
        </button>
      </div>
    </PageScaffold>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/integrations.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/integrations.tsx apps/user-client/tests/component/integrations.test.tsx
git commit -m "Rebuild Integrations list in the design language

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 5: Wire the detail routes and retire the old components

Registers the two detail routes and deletes the now-unused overlay + section (and their one trivial test).

**Files:**
- Modify: `apps/user-client/src/App.tsx`
- Delete: `apps/user-client/src/components/mcp/McpServerSheet.tsx`
- Delete: `apps/user-client/src/components/mcp/McpServersSection.tsx`
- Delete: `apps/user-client/tests/components/mcp/McpServersSection.test.tsx`

**Interfaces:**
- Consumes: `IntegrationServerPage` (Task 3), `Integrations` (Task 4).

- [ ] **Step 1: Register the routes**

In `apps/user-client/src/App.tsx`, add the import beside the existing `Integrations` import (line ~18):

```tsx
import { IntegrationServerPage } from './routes/app/integrations/server.js';
```

Directly after the existing `<Route path="/app/integrations" element={<Integrations />} />` line, add:

```tsx
                  <Route path="/app/integrations/new" element={<IntegrationServerPage />} />
                  <Route path="/app/integrations/:serverId" element={<IntegrationServerPage />} />
```

- [ ] **Step 2: Delete the retired components and their test**

```bash
git rm apps/user-client/src/components/mcp/McpServerSheet.tsx \
       apps/user-client/src/components/mcp/McpServersSection.tsx \
       apps/user-client/tests/components/mcp/McpServersSection.test.tsx
```

(Leave `apps/user-client/src/components/mcp/McpApprovalPrompt.tsx` — it is the chat tool-approval prompt, unrelated to this surface.)

- [ ] **Step 3: Verify no dangling references**

Run: `rg -n "McpServerSheet|McpServersSection" apps/user-client/src apps/user-client/tests`
Expected: no matches. If any appear, they are stale imports — remove them.

- [ ] **Step 4: Run the affected suites**

Run: `pnpm --filter @chatsundere/user-client test tests/component/integrations.test.tsx tests/component/integration-server.test.tsx tests/routes/entrance-hall.filter.test.tsx tests/unit/entrance-hall.test.tsx`
Expected: PASS. The entrance-hall suites still find the enabled "My Integrations" tile (its route `/app/integrations` is unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/App.tsx
git commit -m "Wire Integrations detail routes and retire the MCP overlay

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

### Task 6: Retrofit the AI Providers detail page with the dirty-guard

Adopts the shared guard on the sibling detail page so the makeover stays consistent: a typed-but-unsaved API key now warns on leave and shows a passive `● Unsaved` badge.

**Files:**
- Modify: `apps/user-client/src/routes/app/settings/provider.tsx`
- Modify: `apps/user-client/tests/component/settings-provider.test.tsx`

**Interfaces:**
- Consumes: `PageScaffold.dirty` (Task 1), `Badge`.

- [ ] **Step 1: Write the failing test**

Append these two tests inside the `describe('SettingsProviderPage', …)` block in `apps/user-client/tests/component/settings-provider.test.tsx` (before the closing `});`):

```tsx
  it('shows a passive Unsaved badge once an API key is typed', async () => {
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });

  it('guards Back with a discard confirm when an API key is unsaved', async () => {
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(screen.queryByText('providers list')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatsundere/user-client test tests/component/settings-provider.test.tsx`
Expected: the two new tests FAIL (no Unsaved badge; Back navigates straight to "providers list").

- [ ] **Step 3: Apply the guard**

In `apps/user-client/src/routes/app/settings/provider.tsx`:

1. Add the Badge import beside the other `components/ui` imports:
```tsx
import { Badge } from '../../../components/ui/Badge.js';
```
2. On the main `PageScaffold` (the one wrapping the form, NOT the unknown-`definition` branch), add the `dirty` prop:
```tsx
      back="/app/settings/providers"
      onHelp={onHelp}
      dirty={apiKey !== ''}
```
3. Wrap the Test & Save button in a row carrying the passive badge. Replace:
```tsx
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Test & Save'}
        </button>
```
with:
```tsx
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className="rounded-md bg-paper px-3 py-2 text-xs uppercase tracking-wider text-ink hover:bg-paper-soft disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Test & Save'}
          </button>
          {apiKey !== '' ? <Badge tone="warning">● Unsaved</Badge> : null}
        </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client test tests/component/settings-provider.test.tsx`
Expected: PASS — the two new tests plus all pre-existing seal/probe regression tests (the guard only affects chrome navigation, not Save).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/routes/app/settings/provider.tsx apps/user-client/tests/component/settings-provider.test.tsx
git commit -m "Adopt the dirty-guard on the AI Providers detail page

Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] Run `pnpm typecheck --force` from the repo root. Expected: 14/14 packages pass (do not trust a cached pass on test-touching work).
- [ ] Run the full user-client suite: `pnpm --filter @chatsundere/user-client test`. Expected: the **8 Node-localStorage baseline** failures only; every new and touched suite green. A 9th failure is real — investigate.
- [ ] Run `pnpm --filter @chatsundere/user-client run build` (or the repo `pnpm run build`). Expected: clean production build (no dead-import breakage from the deletions).
- [ ] `rg -n "McpServerSheet|McpServersSection" apps/user-client` returns nothing.

## Self-Review notes (already reconciled against the spec)

- **Spec coverage:** §2 routing → Task 5; §3 list → Task 4 (+ help Task 2); §4 detail + §4.5 dirty-guard → Tasks 3 + 1 (+ provider retrofit Task 6); §4.4 unknown-id → Task 3 outer shell; §7 fresh tests → every task's TDD step; §8 audit → handled outside the plan (Laura pre-squash).
- **Async-seed correctness:** the outer/inner split (Task 3) is the deliberate fix for the My Account display-name class of bug — the inner form only mounts once `servers.data` is loaded, so its `useState(existing?…)` seeds are correct in edit mode.
- **Types:** `IntegrationServerPage` (no props) is what App.tsx and the test consume; the inner `IntegrationServerForm` takes `{ existing?: McpServerRow }`. `statusOf` is duplicated verbatim into the list page (the only consumer; the former shared site is deleted).
