# MCP Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let companions call tools from external HTTPS MCP servers, configured in a new "MCP Servers" settings tab, routed through the user's CORS proxy when direct calls are CORS-blocked, gated per-persona and behind a per-server approval prompt.

**Architecture:** A browser-side MCP client (JSON-RPC over Streamable HTTP, ported from chatsune) wrapped as a **context-tools category** in `resolveActiveTools` (the knowledge/expert precedent, NOT the `Integration` array). Servers live in a new Dexie v17 `mcpServers` table; per-persona tri-state overrides on `PersonaRow.mcpOverrides`; tool calls pause for an approval prompt unless the server is `autoRun`.

**Tech Stack:** TypeScript (strict), React 18, Dexie, TanStack Query, Zustand, Bun test runner (llm-unified) / Vitest (user-client), `@chatsundere/crypto` (`sealSecret`/`openSecret`), Biome.

Spec: `superpowers/specs/2026-06-08-mcp-client-design.md`. Read it first.

**Conventions for every task:** British English in all artefacts. Run from repo root. Commit after each task with `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`; do NOT push, merge, or switch branches (that is Liz's job). Type-gate with `pnpm typecheck` and the relevant test runner per the Quality Bar.

**Topological order:** types/naming → transport → connectivity → data/Dexie → approval store → tool builder → registry wiring → send-path wiring → UI (settings, sheet, persona, approval prompt) → security/docs/verify. Each task's imports only reference earlier tasks (the `vi.mock`-hides-a-missing-module lesson).

**Reference files to mirror (read them, do not reinvent):**
- Tool shape + lazy execute: `apps/user-client/src/integrations/web/web-integration.ts`
- Context-tools wiring: `apps/user-client/src/tools/registry.ts`, `apps/user-client/src/knowledge/query-tool.ts`
- JSON-RPC client to port: `~/workspace/chatsune/frontend/src/features/mcp/mcpClient.ts` (+ its `__tests__/mcpClient.test.ts`)
- Sealing: `apps/user-client/src/lib/secrets.ts`, `apps/user-client/src/components/ProviderSheet.tsx`, `apps/user-client/src/credentials/sources/provider-key-source.ts`
- Dexie versions: `apps/user-client/src/boot/client-data-db.ts` (current highest = **v16**)
- Settings UI: `apps/user-client/src/routes/app/settings.tsx` (`ExpertModelSetting`, `ProvidersSection`, `WebInterfacingSettings`, `AccordionCard` usage)
- Data hooks: `apps/user-client/src/data/providers.ts`, `apps/user-client/src/data/settings.ts`
- Persona sub-section: `apps/user-client/src/components/persona-editor/KnowledgeSection.tsx`; route `apps/user-client/src/routes/app/persona-editor.tsx`
- Stream wiring: `apps/user-client/src/state/stream-manager.store.ts` (resolveActiveTools call ~line 391), `apps/user-client/src/data/send-message.ts` (knowledge-context build)

---

## Task 1: MCP shared types + tool-name prefixing

**Files:**
- Create: `apps/user-client/src/mcp/types.ts`
- Create: `apps/user-client/src/mcp/tool-naming.ts`
- Test: `apps/user-client/src/mcp/tool-naming.test.ts`

- [ ] **Step 1: Create the shared types**

`apps/user-client/src/mcp/types.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

/** A tool as advertised by an MCP server's `tools/list`. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type McpRouting = 'direct' | 'proxy';

/** How a single MCP call reaches its server. Built per call: `auth.value`
 *  carries the opened plaintext key (never persisted). */
export interface McpEndpoint {
  /** Resolved endpoint URL (bare or +/mcp), as decided by the connection test. */
  url: string;
  routing: McpRouting;
  /** Required when routing === 'proxy'. */
  corsProxy: { url: string; key: string } | null;
  /** Auth header to send to the upstream, or null. */
  auth: { header: string; value: string } | null;
}

/** Outcome of a single connection probe. */
export interface McpProbeResult {
  ok: boolean;
  tools: McpToolDefinition[];
  error: string | null;
}

/** A candidate (routing × URL variant) the connection test tries in order. */
export interface McpCandidate {
  routing: McpRouting;
  url: string;
}

/** Resolved outcome of the connection test for a server. */
export interface McpConnectionResult {
  ok: boolean;
  routing: McpRouting | null;
  resolvedEndpoint: string | null;
  tools: McpToolDefinition[];
  error: string | null;
}
```

- [ ] **Step 2: Write the failing test for tool-naming**

`apps/user-client/src/mcp/tool-naming.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { applyPrefix, buildMcpToolNames, sanitiseToolName } from './tool-naming.js';

describe('sanitiseToolName', () => {
  it('keeps allowed chars, replaces the rest with underscore', () => {
    expect(sanitiseToolName('create.issue/now')).toBe('create_issue_now');
    expect(sanitiseToolName('Search Web!')).toBe('Search_Web_');
  });
  it('clips to 64 chars', () => {
    expect(sanitiseToolName('a'.repeat(80))).toHaveLength(64);
  });
});

describe('applyPrefix', () => {
  it('joins prefix and name, sanitised and clipped', () => {
    expect(applyPrefix('github', 'create_issue')).toBe('github_create_issue');
    expect(applyPrefix('weird srv', 'do.thing')).toBe('weird_srv_do_thing');
  });
});

describe('buildMcpToolNames', () => {
  const servers = [
    { id: 's1', prefix: 'github', tools: [{ name: 'search' }, { name: 'create_issue' }] },
    { id: 's2', prefix: 'github', tools: [{ name: 'search' }] }, // prefix collision
  ];

  it('produces unique wire names and a reverse map', () => {
    const { tools, reverse } = buildMcpToolNames(servers);
    const names = tools.map((t) => t.wireName);
    expect(new Set(names).size).toBe(names.length); // all unique
    // reverse map round-trips
    for (const t of tools) {
      expect(reverse.get(t.wireName)).toEqual({ serverId: t.serverId, originalName: t.originalName });
    }
  });

  it('keeps a non-colliding name stable (no discriminator)', () => {
    const { tools } = buildMcpToolNames([servers[0]]);
    expect(tools.find((t) => t.originalName === 'search')?.wireName).toBe('github_search');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/tool-naming.test.ts`
Expected: FAIL — module `./tool-naming.js` not found.

- [ ] **Step 4: Implement tool-naming**

`apps/user-client/src/mcp/tool-naming.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only

const MAX_NAME = 64;

/** OpenAI-compatible tool names allow only [a-zA-Z0-9_-], max 64 chars. */
export function sanitiseToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_NAME);
}

export function applyPrefix(prefix: string, name: string): string {
  return sanitiseToolName(`${prefix}_${name}`);
}

interface NamingServer {
  id: string;
  prefix: string;
  tools: { name: string }[];
}

export interface NamedTool {
  serverId: string;
  originalName: string;
  wireName: string;
}

/** Build collision-free wire names across all active servers plus a reverse map
 *  (wireName → {serverId, originalName}) for dispatch. Deterministic: a clashing
 *  wire name gets a numeric discriminator appended. */
export function buildMcpToolNames(servers: NamingServer[]): {
  tools: NamedTool[];
  reverse: Map<string, { serverId: string; originalName: string }>;
} {
  const used = new Set<string>();
  const tools: NamedTool[] = [];
  const reverse = new Map<string, { serverId: string; originalName: string }>();

  for (const server of servers) {
    for (const tool of server.tools) {
      let wireName = applyPrefix(server.prefix, tool.name);
      if (used.has(wireName)) {
        let n = 2;
        // Clip so the discriminator still fits in 64 chars.
        const base = wireName.slice(0, MAX_NAME - 3);
        while (used.has(`${base}_${n}`)) n++;
        wireName = `${base}_${n}`;
      }
      used.add(wireName);
      tools.push({ serverId: server.id, originalName: tool.name, wireName });
      reverse.set(wireName, { serverId: server.id, originalName: tool.name });
    }
  }
  return { tools, reverse };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/tool-naming.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/mcp/types.ts apps/user-client/src/mcp/tool-naming.ts apps/user-client/src/mcp/tool-naming.test.ts
git commit -m "Add MCP shared types and tool-name prefixing"
```

---

## Task 2: MCP JSON-RPC transport (Streamable HTTP)

**Files:**
- Create: `apps/user-client/src/mcp/mcp-client.ts`
- Test: `apps/user-client/src/mcp/mcp-client.test.ts`

Port chatsune's `mcpClient.ts` (read it). Key adaptations for Chatsundere:
- No backend-proxied path (drop `mcpProxyToolsList`/`mcpProxyToolsCall`).
- Routing is built from an `McpEndpoint` (direct vs CORS proxy via `x-cors-proxy-target` / `x-cors-proxy-api-key`), not a bare gateway URL + `/mcp` append.
- Session cache is a module-level `Map` keyed by `endpoint.url` (chatsune used a zustand store; a plain map is enough here).

- [ ] **Step 1: Write the failing test**

`apps/user-client/src/mcp/mcp-client.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetMcpSessions, mcpToolsCall, mcpToolsList, readJsonRpcResponse } from './mcp-client.js';
import type { McpEndpoint } from './types.js';

const directEndpoint: McpEndpoint = {
  url: 'https://mcp.example.com/mcp',
  routing: 'direct',
  corsProxy: null,
  auth: { header: 'Authorization', value: 'Bearer k' },
};

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sseResponse(objs: unknown[], headers: Record<string, string> = {}): Response {
  const body = objs.map((o) => `data: ${JSON.stringify(o)}\n`).join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

afterEach(() => {
  __resetMcpSessions();
  vi.restoreAllMocks();
});

describe('readJsonRpcResponse', () => {
  it('parses application/json', async () => {
    const reply = await readJsonRpcResponse(jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } }), 1);
    expect(reply.result).toEqual({ ok: true });
  });
  it('parses the matching id out of an SSE stream', async () => {
    const reply = await readJsonRpcResponse(
      sseResponse([{ jsonrpc: '2.0', id: 9, result: { tools: [] } }]),
      9,
    );
    expect(reply.result).toEqual({ tools: [] });
  });
});

describe('mcpToolsList', () => {
  it('initialises (capturing the session id) then lists tools', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // initialize
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 'sess-1' }))
      // notifications/initialized
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      // tools/list
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search', description: 'd', inputSchema: {} }] } }),
      );

    const tools = await mcpToolsList(directEndpoint);
    expect(tools).toEqual([{ name: 'search', description: 'd', inputSchema: {} }]);
    // tools/list carried the captured session id
    const listCall = fetchMock.mock.calls[2];
    const listReq = listCall[0] as Request;
    expect(listReq.headers.get('mcp-session-id')).toBe('sess-1');
  });
});

describe('mcpToolsCall', () => {
  it('returns the joined text content on success', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'hello' }] } }),
      );
    const r = await mcpToolsCall(directEndpoint, 'search', { q: 'x' });
    expect(r).toEqual({ stdout: 'hello', error: null });
  });

  it('surfaces an isError result as a constructive error', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'boom' }] } }),
      );
    const r = await mcpToolsCall(directEndpoint, 'search', {});
    expect(r.error).toBe('boom');
  });
});

describe('proxy routing', () => {
  it('targets the proxy URL with the cors-proxy headers and forwards the path', async () => {
    const proxyEndpoint: McpEndpoint = {
      url: 'https://mcp.example.com/mcp',
      routing: 'proxy',
      corsProxy: { url: 'https://cors-proxy.tidesson.net', key: 'pk' },
      auth: { header: 'Authorization', value: 'Bearer k' },
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's' }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } }));
    await mcpToolsList(proxyEndpoint);
    const initReq = fetchMock.mock.calls[0][0] as Request;
    expect(initReq.url).toBe('https://cors-proxy.tidesson.net/mcp');
    expect(initReq.headers.get('x-cors-proxy-target')).toBe('https://mcp.example.com');
    expect(initReq.headers.get('x-cors-proxy-api-key')).toBe('pk');
    expect(initReq.headers.get('authorization')).toBe('Bearer k');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/mcp-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transport**

`apps/user-client/src/mcp/mcp-client.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { McpEndpoint, McpToolDefinition } from './types.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'chatsundere', version: '0.1.0' };

interface JsonRpcReply {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

let requestId = 0;
const nextId = (): number => ++requestId;

/** Per-endpoint session cache (keyed by endpoint.url). */
const sessions = new Map<string, { sessionId: string | null; initialising?: Promise<string | null> }>();

/** Test helper — clears the session cache and request counter. */
export function __resetMcpSessions(): void {
  sessions.clear();
  requestId = 0;
}

/** Build a fetch Request for one JSON-RPC POST, honouring direct vs proxy routing. */
function buildRequest(
  endpoint: McpEndpoint,
  body: unknown,
  sessionId: string | null,
  signal?: AbortSignal,
): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  });
  if (endpoint.auth) headers.set(endpoint.auth.header, endpoint.auth.value);
  if (sessionId) headers.set('Mcp-Session-Id', sessionId);

  let url: string;
  if (endpoint.routing === 'direct') {
    url = endpoint.url;
  } else {
    if (!endpoint.corsProxy) throw new Error('MCP proxy routing selected but no CORS proxy configured');
    const target = new URL(endpoint.url);
    headers.set('x-cors-proxy-api-key', endpoint.corsProxy.key);
    headers.set('x-cors-proxy-target', target.origin);
    url = joinUrl(endpoint.corsProxy.url, target.pathname + target.search);
  }
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/** Read a JSON-RPC reply from either an application/json or text/event-stream body. */
export async function readJsonRpcResponse(resp: Response, expectedId?: number): Promise<JsonRpcReply> {
  const ctype = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ctype === 'application/json') return (await resp.json()) as JsonRpcReply;
  if (ctype === 'text/event-stream') {
    if (!resp.body) throw new Error('SSE response has no body');
    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (!data) continue;
        try {
          const obj = JSON.parse(data) as JsonRpcReply;
          if (expectedId === undefined || obj.id === expectedId) return obj;
        } catch {
          // malformed — skip
        }
      }
    }
    throw new Error('SSE stream closed without a matching response');
  }
  throw new Error(`Unexpected content-type from MCP server: ${ctype}`);
}

async function doInitialise(endpoint: McpEndpoint, signal?: AbortSignal): Promise<string | null> {
  const initId = nextId();
  const initResp = await fetch(
    buildRequest(
      endpoint,
      {
        jsonrpc: '2.0',
        id: initId,
        method: 'initialize',
        params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      null,
      signal,
    ),
  );
  if (!initResp.ok) throw new Error(`MCP initialise failed: HTTP ${initResp.status}`);
  const sessionId = initResp.headers.get('mcp-session-id');
  try {
    await readJsonRpcResponse(initResp, initId);
  } catch {
    // the session-id header is what we need from this step
  }
  await fetch(buildRequest(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId, signal));
  return sessionId;
}

async function ensureSession(endpoint: McpEndpoint, signal?: AbortSignal): Promise<string | null> {
  const existing = sessions.get(endpoint.url);
  if (existing && existing.sessionId !== undefined && !existing.initialising) return existing.sessionId;
  if (existing?.initialising) return existing.initialising;
  const initPromise = doInitialise(endpoint, signal);
  sessions.set(endpoint.url, { sessionId: null, initialising: initPromise });
  try {
    const sessionId = await initPromise;
    sessions.set(endpoint.url, { sessionId });
    return sessionId;
  } catch (e) {
    sessions.delete(endpoint.url);
    throw e;
  }
}

export async function mcpToolsList(endpoint: McpEndpoint, timeoutMs = 10_000): Promise<McpToolDefinition[]> {
  const sessionId = await ensureSession(endpoint);
  const resp = await fetch(
    buildRequest(endpoint, { jsonrpc: '2.0', id: nextId(), method: 'tools/list' }, sessionId, AbortSignal.timeout(timeoutMs)),
  );
  if (!resp.ok) {
    if (resp.status === 404) sessions.delete(endpoint.url);
    throw new Error(`MCP tools/list failed: HTTP ${resp.status}`);
  }
  const body = await readJsonRpcResponse(resp);
  if (body.error) throw new Error(body.error.message || 'tools/list error');
  const result = (body.result || {}) as { tools?: McpToolDefinition[] };
  return result.tools ?? [];
}

export async function mcpToolsCall(
  endpoint: McpEndpoint,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<{ stdout: string; error: string | null }> {
  let sessionId: string | null;
  try {
    sessionId = await ensureSession(endpoint, signal);
  } catch (e) {
    return { stdout: '', error: `MCP initialise failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  const callOnce = (sid: string | null): Promise<Response> =>
    fetch(
      buildRequest(
        endpoint,
        { jsonrpc: '2.0', id: nextId(), method: 'tools/call', params: { name: toolName, arguments: args } },
        sid,
        signal ?? AbortSignal.timeout(timeoutMs),
      ),
    );

  let resp: Response;
  try {
    resp = await callOnce(sessionId);
    if (resp.status === 404 && sessionId) {
      sessions.delete(endpoint.url);
      sessionId = await ensureSession(endpoint, signal);
      resp = await callOnce(sessionId);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') return { stdout: '', error: `MCP server timed out after ${timeoutMs}ms` };
    return { stdout: '', error: `MCP server unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok) return { stdout: '', error: `MCP server returned HTTP ${resp.status}` };

  let body: JsonRpcReply;
  try {
    body = await readJsonRpcResponse(resp);
  } catch (e) {
    return { stdout: '', error: `MCP response read failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (body.error) return { stdout: '', error: `MCP error: ${body.error.message || 'unknown'}` };

  const result = (body.result || {}) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  if (result.isError) return { stdout: '', error: text || 'Tool returned an error' };
  return { stdout: text, error: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/mcp-client.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/mcp/mcp-client.ts apps/user-client/src/mcp/mcp-client.test.ts
git commit -m "Add browser-side MCP JSON-RPC transport"
```

---

## Task 3: Connection test (direct→proxy, URL variants)

**Files:**
- Create: `apps/user-client/src/mcp/mcp-connectivity.ts`
- Test: `apps/user-client/src/mcp/mcp-connectivity.test.ts`

The decision logic is pure over an injected `probe(candidate)` so it is unit-testable without the network. The default `probe` builds an `McpEndpoint` and calls `mcpToolsList` (after a successful `initialise`).

- [ ] **Step 1: Write the failing test**

`apps/user-client/src/mcp/mcp-connectivity.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { buildCandidates, resolveConnection } from './mcp-connectivity.js';
import type { McpCandidate, McpProbeResult } from './types.js';

describe('buildCandidates', () => {
  it('direct first (bare then +/mcp), then proxy variants when a proxy exists', () => {
    expect(buildCandidates('https://x.io/api', true)).toEqual([
      { routing: 'direct', url: 'https://x.io/api' },
      { routing: 'direct', url: 'https://x.io/api/mcp' },
      { routing: 'proxy', url: 'https://x.io/api' },
      { routing: 'proxy', url: 'https://x.io/api/mcp' },
    ]);
  });
  it('omits proxy candidates without a proxy', () => {
    expect(buildCandidates('https://x.io/mcp', false)).toEqual([
      { routing: 'direct', url: 'https://x.io/mcp' },
      { routing: 'direct', url: 'https://x.io/mcp/mcp' },
    ]);
  });
  it('does not double-append /mcp when the URL already ends in /mcp', () => {
    const c = buildCandidates('https://x.io/mcp', false);
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ routing: 'direct', url: 'https://x.io/mcp' });
  });
});

describe('resolveConnection', () => {
  const probeFor = (results: Record<string, McpProbeResult>) => (c: McpCandidate) =>
    Promise.resolve(results[`${c.routing} ${c.url}`] ?? { ok: false, tools: [], error: 'no' });

  it('stops at the first success and reports its routing + endpoint + tools', async () => {
    const probe = probeFor({
      'direct https://x.io/mcp': { ok: true, tools: [{ name: 't', description: '', inputSchema: {} }], error: null },
    });
    const r = await resolveConnection([
      { routing: 'direct', url: 'https://x.io' },
      { routing: 'direct', url: 'https://x.io/mcp' },
    ], probe);
    expect(r).toMatchObject({ ok: true, routing: 'direct', resolvedEndpoint: 'https://x.io/mcp' });
    expect(r.tools).toHaveLength(1);
  });

  it('falls through to proxy when direct fails', async () => {
    const probe = probeFor({
      'proxy https://x.io/mcp': { ok: true, tools: [], error: null },
    });
    const r = await resolveConnection([
      { routing: 'direct', url: 'https://x.io/mcp' },
      { routing: 'proxy', url: 'https://x.io/mcp' },
    ], probe);
    expect(r).toMatchObject({ ok: true, routing: 'proxy', resolvedEndpoint: 'https://x.io/mcp' });
  });

  it('returns the last error when every candidate fails', async () => {
    const probe = () => Promise.resolve({ ok: false, tools: [], error: 'blocked by allowlist' });
    const r = await resolveConnection([{ routing: 'proxy', url: 'https://x.io/mcp' }], probe);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked by allowlist');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/mcp-connectivity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement connectivity**

`apps/user-client/src/mcp/mcp-connectivity.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { mcpToolsList } from './mcp-client.js';
import type { McpAuthResolved, McpCandidate, McpConnectionResult, McpProbeResult, McpRouting } from './types.js';

/** Build the ordered probe candidates: direct (bare, +/mcp) then proxy (bare, +/mcp). */
export function buildCandidates(url: string, hasProxy: boolean): McpCandidate[] {
  const trimmed = url.replace(/\/+$/, '');
  const variants = trimmed.endsWith('/mcp') ? [trimmed] : [trimmed, `${trimmed}/mcp`];
  const routings: McpRouting[] = hasProxy ? ['direct', 'proxy'] : ['direct'];
  return routings.flatMap((routing) => variants.map((u) => ({ routing, url: u })));
}

/** Run candidates in order, stop at the first success. Pure over `probe`. */
export async function resolveConnection(
  candidates: McpCandidate[],
  probe: (c: McpCandidate) => Promise<McpProbeResult>,
): Promise<McpConnectionResult> {
  let lastError = 'No candidates';
  for (const c of candidates) {
    const r = await probe(c);
    if (r.ok) {
      return { ok: true, routing: c.routing, resolvedEndpoint: c.url, tools: r.tools, error: null };
    }
    lastError = r.error ?? 'unknown';
  }
  return { ok: false, routing: null, resolvedEndpoint: null, tools: [], error: lastError };
}

/** The live probe: initialise + tools/list against a candidate. */
export function liveProbe(
  corsProxy: { url: string; key: string } | null,
  auth: McpAuthResolved | null,
): (c: McpCandidate) => Promise<McpProbeResult> {
  return async (c) => {
    try {
      const tools = await mcpToolsList({
        url: c.url,
        routing: c.routing,
        corsProxy: c.routing === 'proxy' ? corsProxy : null,
        auth,
      });
      return { ok: true, tools, error: null };
    } catch (e) {
      return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/** Top-level entry the UI calls. */
export async function testMcpConnection(input: {
  url: string;
  hasProxy: boolean;
  corsProxy: { url: string; key: string } | null;
  auth: McpAuthResolved | null;
}): Promise<McpConnectionResult> {
  return resolveConnection(buildCandidates(input.url, input.hasProxy), liveProbe(input.corsProxy, input.auth));
}
```

> `McpAuthResolved` lives in `mcp/types.ts` (added in Task 1 — see below), so both `mcp-connectivity.ts` and `mcp-tools.ts` import it from there with no forward reference. Add it to `mcp/types.ts` now:

```ts
/** A resolved auth header (plaintext key already opened). */
export interface McpAuthResolved {
  header: string;
  value: string;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/mcp-connectivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/mcp/mcp-connectivity.ts apps/user-client/src/mcp/mcp-connectivity.test.ts apps/user-client/src/mcp/types.ts
git commit -m "Add MCP connection test (direct/proxy, URL variants)"
```

---

## Task 4: Dexie v17 — mcpServers table + persona overrides + data layer

**Files:**
- Modify: `apps/user-client/src/boot/client-data-db.ts`
- Create: `apps/user-client/src/data/mcp-servers.ts`
- Create: `apps/user-client/src/mcp/resolve-active.ts`
- Test: `apps/user-client/src/mcp/resolve-active.test.ts`

- [ ] **Step 1: Add `McpServerRow`, the table, `mcpOverrides`, and version 17**

In `client-data-db.ts`, add the row interface (near `ProviderRow`):

```ts
export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  prefix: string;
  auth:
    | { scheme: 'bearer'; key: EncryptedBlob }
    | { scheme: 'header'; headerName: string; key: EncryptedBlob }
    | null;
  onByDefault: boolean;
  autoRun: boolean;
  enabled: boolean;
  routing: 'direct' | 'proxy' | null;
  resolvedEndpoint: string | null;
  tools: McpToolDefinition[];
  hiddenTools: string[];
  lastTestedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}
```

Add the import at the top: `import type { McpToolDefinition } from '../mcp/types.js';`

Add `mcpOverrides` to `PersonaRow` (after `askExpertDefault`):

```ts
  /** Per-persona MCP server overrides. Unset key → server.onByDefault applies. */
  mcpOverrides: Record<string, 'on' | 'off'>;
```

Add the table property to the `ClientDataDb` class (after `documents!`):

```ts
  mcpServers!: Table<McpServerRow, string>;
```

Append version 17 (after the v16 block):

```ts
    // Version 17 — MCP client. New `mcpServers` table; personas gain
    // `mcpOverrides` (tri-state per server; unset → the server default).
    this.version(17)
      .stores({
        mcpServers: 'id',
        personas: 'id, providerId',
      })
      .upgrade(async (tx) => {
        await tx
          .table('personas')
          .toCollection()
          .modify((p: Record<string, unknown>) => {
            if (typeof p.mcpOverrides !== 'object' || p.mcpOverrides === null) p.mcpOverrides = {};
          });
      });
```

- [ ] **Step 2: Update persona fixtures / `defaultDraft` so typecheck stays green**

Search for every place that constructs a `PersonaRow` or `DraftPersona` literal (tests, seeds, `routes/app/persona-editor.tsx` `defaultDraft`). Add `mcpOverrides: {}` to each. Run:

```bash
rg -n "askExpertDefault:" apps/user-client/src --type ts -g '!*.test.*'
rg -n "askExpertDefault:" apps/user-client/src --type ts -g '*.test.*'
```

Add `mcpOverrides: {}` adjacent to each `askExpertDefault:` literal (same objects carry both).

- [ ] **Step 3: Write the failing test for `resolveActiveServers`**

`apps/user-client/src/mcp/resolve-active.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { resolveActiveServers } from './resolve-active.js';
import type { McpServerRow } from '../boot/client-data-db.js';

const base = (over: Partial<McpServerRow>): McpServerRow => ({
  id: 's', name: 'S', url: 'https://s/mcp', prefix: 's', auth: null,
  onByDefault: true, autoRun: false, enabled: true, routing: 'direct',
  resolvedEndpoint: 'https://s/mcp', tools: [], hiddenTools: [],
  lastTestedAt: 1, lastError: null, createdAt: 1, updatedAt: 1, ...over,
});

describe('resolveActiveServers', () => {
  it('default on, no override → active', () => {
    const r = resolveActiveServers([base({ id: 'a', onByDefault: true })], {}, true);
    expect(r.map((s) => s.id)).toEqual(['a']);
  });
  it('default off, override on → active', () => {
    const r = resolveActiveServers([base({ id: 'a', onByDefault: false })], { a: 'on' }, true);
    expect(r.map((s) => s.id)).toEqual(['a']);
  });
  it('default on, override off → inactive', () => {
    const r = resolveActiveServers([base({ id: 'a', onByDefault: true })], { a: 'off' }, true);
    expect(r).toEqual([]);
  });
  it('disabled server is never active', () => {
    const r = resolveActiveServers([base({ id: 'a', enabled: false })], { a: 'on' }, true);
    expect(r).toEqual([]);
  });
  it('untested server (routing null) is never active', () => {
    const r = resolveActiveServers([base({ id: 'a', routing: null, resolvedEndpoint: null })], {}, true);
    expect(r).toEqual([]);
  });
  it('proxy-routed server with no proxy configured is inactive', () => {
    const r = resolveActiveServers([base({ id: 'a', routing: 'proxy' })], {}, false);
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/resolve-active.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `resolve-active.ts`**

`apps/user-client/src/mcp/resolve-active.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { McpServerRow } from '../boot/client-data-db.js';

/** The servers active for a persona this send: enabled, successfully tested,
 *  on by default-or-override, and reachable given the proxy state. */
export function resolveActiveServers(
  servers: McpServerRow[],
  overrides: Record<string, 'on' | 'off'>,
  hasProxy: boolean,
): McpServerRow[] {
  return servers.filter((s) => {
    if (!s.enabled) return false;
    if (s.routing === null || s.resolvedEndpoint === null) return false;
    if (s.routing === 'proxy' && !hasProxy) return false;
    const ov = overrides[s.id];
    return ov ? ov === 'on' : s.onByDefault;
  });
}
```

- [ ] **Step 6: Implement the data hooks** (`data/mcp-servers.ts`)

Mirror `apps/user-client/src/data/providers.ts` exactly (read it for the precise `useQuery`/`useMutation` + invalidation shape). The module must export:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MasterKey } from '@chatsundere/crypto';
import { type McpServerRow, getClientDataDb } from '../boot/client-data-db.js';
import { openSecret, sealSecret } from '../lib/secrets.js';

const KEY = ['mcp-servers'];

export function useMcpServers() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<McpServerRow[]> => getClientDataDb().mcpServers.orderBy('createdAt').toArray(),
  });
}

export function useUpsertMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: McpServerRow): Promise<McpServerRow> => {
      await getClientDataDb().mcpServers.put(row);
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await getClientDataDb().mcpServers.delete(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Seal an MCP server key under the server's slot. */
export function sealMcpKey(plaintext: string, mk: MasterKey, serverId: string) {
  return sealSecret(plaintext, mk, `mcp/${serverId}/api-key`);
}

/** Open the sealed key for a server row, or null if it has no auth. */
export async function openMcpKey(row: McpServerRow, mk: MasterKey): Promise<string | null> {
  if (!row.auth) return null;
  return openSecret(row.auth.key, mk, `mcp/${row.id}/api-key`);
}
```

> If `mcpServers.orderBy('createdAt')` requires `createdAt` to be indexed, change the v17 store string to `mcpServers: 'id, createdAt'`. Otherwise read `.toArray()` and sort in memory. Pick whichever matches the `providers.ts` convention you observe.

- [ ] **Step 7: Run the resolve-active test + full typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/resolve-active.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: green (fixtures updated in Step 2).

- [ ] **Step 8: Commit**

```bash
git add apps/user-client/src/boot/client-data-db.ts apps/user-client/src/data/mcp-servers.ts apps/user-client/src/mcp/resolve-active.ts apps/user-client/src/mcp/resolve-active.test.ts apps/user-client/src
git commit -m "Add Dexie v17 mcpServers table, persona overrides, and data layer"
```

---

## Task 5: Approval store

**Files:**
- Create: `apps/user-client/src/state/mcp-approval.store.ts`
- Test: `apps/user-client/src/state/mcp-approval.store.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/user-client/src/state/mcp-approval.store.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useMcpApprovalStore } from './mcp-approval.store.js';

beforeEach(() => useMcpApprovalStore.setState({ pending: [] }));

describe('mcp-approval store', () => {
  it('enqueues a request and resolves true on approve', async () => {
    const s = useMcpApprovalStore.getState();
    const p = s.request({ serverId: 's', serverName: 'S', toolName: 'do', args: { a: 1 } });
    const req = useMcpApprovalStore.getState().pending[0];
    expect(req.toolName).toBe('do');
    useMcpApprovalStore.getState().approve(req.id);
    await expect(p).resolves.toBe(true);
    expect(useMcpApprovalStore.getState().pending).toHaveLength(0);
  });

  it('resolves false on deny', async () => {
    const p = useMcpApprovalStore.getState().request({ serverId: 's', serverName: 'S', toolName: 'do', args: {} });
    const req = useMcpApprovalStore.getState().pending[0];
    useMcpApprovalStore.getState().deny(req.id);
    await expect(p).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/state/mcp-approval.store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

`apps/user-client/src/state/mcp-approval.store.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand';

export interface McpApprovalRequest {
  id: string;
  serverId: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface McpApprovalState {
  pending: McpApprovalRequest[];
  request(req: Omit<McpApprovalRequest, 'id'>): Promise<boolean>;
  approve(id: string): void;
  deny(id: string): void;
}

const resolvers = new Map<string, (ok: boolean) => void>();
let seq = 0;

export const useMcpApprovalStore = create<McpApprovalState>((set) => ({
  pending: [],
  request(req) {
    const id = `mcp-approval-${++seq}`;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      set((s) => ({ pending: [...s.pending, { ...req, id }] }));
    });
  },
  approve(id) {
    resolvers.get(id)?.(true);
    resolvers.delete(id);
    set((s) => ({ pending: s.pending.filter((r) => r.id !== id) }));
  },
  deny(id) {
    resolvers.get(id)?.(false);
    resolvers.delete(id);
    set((s) => ({ pending: s.pending.filter((r) => r.id !== id) }));
  },
}));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/state/mcp-approval.store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/state/mcp-approval.store.ts apps/user-client/src/state/mcp-approval.store.test.ts
git commit -m "Add MCP tool-call approval store"
```

---

## Task 6: MCP tool builder (`contributeMcpTools`)

**Files:**
- Create: `apps/user-client/src/mcp/mcp-tools.ts`
- Test: `apps/user-client/src/mcp/mcp-tools.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/user-client/src/mcp/mcp-tools.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { contributeMcpTools, type McpToolContext } from './mcp-tools.js';

vi.mock('./mcp-client.js', () => ({
  mcpToolsCall: vi.fn(async (_e, name) => ({ stdout: `ran ${name}`, error: null })),
}));

function ctx(over: Partial<McpToolContext> = {}): McpToolContext {
  return {
    servers: [
      {
        id: 's1', name: 'GitHub', prefix: 'github', routing: 'direct',
        resolvedEndpoint: 'https://gh/mcp', auth: { scheme: 'bearer' }, autoRun: true,
        tools: [
          { name: 'search', description: 'd', inputSchema: { type: 'object' } },
          { name: 'secret', description: 'd', inputSchema: {} },
        ],
        hiddenTools: ['secret'],
      },
    ],
    corsProxyUrl: null,
    corsProxyKey: null,
    getServerKey: async () => 'tok',
    requestApproval: async () => true,
    ...over,
  };
}

describe('contributeMcpTools', () => {
  it('builds prefixed tools, excluding hidden ones', () => {
    const tools = contributeMcpTools(ctx());
    expect(tools.map((t) => t.name)).toEqual(['github_search']);
  });

  it('executes via mcpToolsCall when autoRun is on', async () => {
    const tools = contributeMcpTools(ctx());
    const r = await tools[0].execute({ q: 'x' });
    expect(r).toEqual({ ok: true, output: 'ran search', error: null });
  });

  it('returns a constructive error when the user denies', async () => {
    const tools = contributeMcpTools(ctx({
      servers: [{
        id: 's1', name: 'GitHub', prefix: 'github', routing: 'direct',
        resolvedEndpoint: 'https://gh/mcp', auth: null, autoRun: false,
        tools: [{ name: 'search', description: 'd', inputSchema: {} }], hiddenTools: [],
      }],
      requestApproval: async () => false,
    }));
    const r = await tools[0].execute({});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/declined/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/mcp-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mcp-tools.ts`**

`apps/user-client/src/mcp/mcp-tools.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, ToolResult } from '../tools/types.js';
import { mcpToolsCall } from './mcp-client.js';
import { buildMcpToolNames } from './tool-naming.js';
import type { McpAuthResolved, McpEndpoint, McpToolDefinition } from './types.js';

/** One server resolved active for this send (no plaintext key — opened lazily). */
export interface McpActiveServer {
  id: string;
  name: string;
  prefix: string;
  routing: 'direct' | 'proxy';
  resolvedEndpoint: string;
  auth: { scheme: 'bearer' } | { scheme: 'header'; headerName: string } | null;
  autoRun: boolean;
  tools: McpToolDefinition[];
  hiddenTools: string[];
}

export interface McpToolContext {
  servers: McpActiveServer[];
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  /** Opens a server's plaintext key (MasterKey-gated) at call time, or null. */
  getServerKey: (serverId: string) => Promise<string | null>;
  /** Surfaces an approval request and resolves with the user's decision. */
  requestApproval: (req: {
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<boolean>;
}

function resolveAuth(server: McpActiveServer, key: string | null): McpAuthResolved | null {
  if (!server.auth || !key) return null;
  if (server.auth.scheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
  return { header: server.auth.headerName, value: key };
}

/** Build the active MCP tools for this send. Mirrors `contributeKnowledgeTools`. */
export function contributeMcpTools(ctx: McpToolContext): Tool[] {
  const visible = ctx.servers.map((s) => ({
    server: s,
    visibleTools: s.tools.filter((t) => !s.hiddenTools.includes(t.name)),
  }));
  const { tools: named } = buildMcpToolNames(
    visible.map((v) => ({ id: v.server.id, prefix: v.server.prefix, tools: v.visibleTools })),
  );

  return named.map((n) => {
    const entry = visible.find((v) => v.server.id === n.serverId);
    // biome-ignore lint/style/noNonNullAssertion: entry exists — named derives from visible
    const server = entry!.server;
    // biome-ignore lint/style/noNonNullAssertion: tool exists in the visible set
    const def = entry!.visibleTools.find((t) => t.name === n.originalName)!;
    return {
      name: n.wireName,
      description: def.description,
      parameters: def.inputSchema,
      systemPromptInstruction: null,
      async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
        if (!server.autoRun) {
          const ok = await ctx.requestApproval({
            serverId: server.id,
            serverName: server.name,
            toolName: n.originalName,
            args,
          });
          if (!ok) return { ok: false, output: '', error: `Tool call declined by the user.` };
        }
        try {
          const key = await ctx.getServerKey(server.id);
          const endpoint: McpEndpoint = {
            url: server.resolvedEndpoint,
            routing: server.routing,
            corsProxy:
              server.routing === 'proxy' && ctx.corsProxyUrl && ctx.corsProxyKey
                ? { url: ctx.corsProxyUrl, key: ctx.corsProxyKey }
                : null,
            auth: resolveAuth(server, key),
          };
          const r = await mcpToolsCall(endpoint, n.originalName, args, 30_000, signal);
          if (r.error) return { ok: false, output: '', error: r.error };
          return { ok: true, output: r.stdout, error: null };
        } catch (e) {
          return { ok: false, output: '', error: e instanceof Error ? e.message : 'MCP tool failed.' };
        }
      },
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/mcp-tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/mcp/mcp-tools.ts apps/user-client/src/mcp/mcp-tools.test.ts
git commit -m "Add contributeMcpTools builder with approval gate"
```

---

## Task 7: Wire MCP into `resolveActiveTools`

**Files:**
- Modify: `apps/user-client/src/tools/registry.ts`
- Test: `apps/user-client/src/tools/registry.test.ts` (extend if it exists; else create)

- [ ] **Step 1: Add the failing test**

Add to the registry test:

```ts
import { contributeMcpTools, type McpToolContext } from '../mcp/mcp-tools.js';
import { resolveActiveTools } from './registry.js';
// ... within a describe:
it('includes MCP tools when an mcp context is given', () => {
  const mcp: McpToolContext = {
    servers: [{
      id: 's', name: 'S', prefix: 'srv', routing: 'direct', resolvedEndpoint: 'https://s/mcp',
      auth: null, autoRun: true, tools: [{ name: 'go', description: 'd', inputSchema: {} }], hiddenTools: [],
    }],
    corsProxyUrl: null, corsProxyKey: null,
    getServerKey: async () => null, requestApproval: async () => true,
  };
  const tools = resolveActiveTools(EMPTY_CTX, null, null, mcp);
  expect(tools.some((t) => t.name === 'srv_go')).toBe(true);
});
```

(`EMPTY_CTX` — reuse the existing test's IntegrationContext fixture, or build a minimal one matching `IntegrationContext`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/registry.test.ts`
Expected: FAIL — `resolveActiveTools` takes 3 args / `contributeMcpTools` not wired.

- [ ] **Step 3: Wire it in**

In `registry.ts`, add the import and the fourth parameter:

```ts
import { type McpToolContext, contributeMcpTools } from '../mcp/mcp-tools.js';
```

```ts
export function resolveActiveTools(
  ctx: IntegrationContext,
  knowledge: KnowledgeContext | null = null,
  expert: ExpertToolContext | null = null,
  mcp: McpToolContext | null = null,
): Tool[] {
  return [
    ...STATIC_TOOLS,
    ...INTEGRATIONS.flatMap((i) => i.contributesTools(ctx)),
    ...(knowledge ? contributeKnowledgeTools(knowledge) : []),
    ...(expert ? [createAskExpertTool(expert.base, expert.modelLabel, expert.reasoning, expert.runtimeEnabled)] : []),
    ...(mcp ? contributeMcpTools(mcp) : []),
  ];
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/tools/registry.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/src/tools/registry.ts apps/user-client/src/tools/registry.test.ts
git commit -m "Wire MCP tools into resolveActiveTools as a fourth context"
```

---

## Task 8: Build the MCP context in the send path

**Files:**
- Modify: `apps/user-client/src/data/send-message.ts` (where the knowledge context is built)
- Modify: `apps/user-client/src/state/stream-manager.store.ts` (thread `args.mcp` into `resolveActiveTools`)
- Create: `apps/user-client/src/mcp/build-mcp-context.ts`
- Test: `apps/user-client/src/mcp/build-mcp-context.test.ts`

First **read** `send-message.ts` to find where it reads the persona, builds `knowledge`, and resolves the CORS proxy + MasterKey. Mirror that exactly.

- [ ] **Step 1: Failing test for the context builder**

`apps/user-client/src/mcp/build-mcp-context.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { buildMcpContext } from './build-mcp-context.js';
import type { McpServerRow } from '../boot/client-data-db.js';

const server = (over: Partial<McpServerRow>): McpServerRow => ({
  id: 's', name: 'S', url: 'https://s/mcp', prefix: 's',
  auth: { scheme: 'bearer', key: { version: 1, ciphertext: new Uint8Array(), nonce: new Uint8Array() } as never },
  onByDefault: true, autoRun: false, enabled: true, routing: 'direct', resolvedEndpoint: 'https://s/mcp',
  tools: [{ name: 'go', description: '', inputSchema: {} }], hiddenTools: [],
  lastTestedAt: 1, lastError: null, createdAt: 1, updatedAt: 1, ...over,
});

describe('buildMcpContext', () => {
  it('returns null when no servers resolve active', () => {
    const ctx = buildMcpContext({
      servers: [server({ enabled: false })], overrides: {}, hasProxy: true,
      corsProxyUrl: 'p', corsProxyKey: 'k', mk: {} as never, requestApproval: async () => true,
    });
    expect(ctx).toBeNull();
  });

  it('maps active servers, stripping the sealed key from the active descriptor', () => {
    const ctx = buildMcpContext({
      servers: [server({})], overrides: {}, hasProxy: true,
      corsProxyUrl: 'p', corsProxyKey: 'k', mk: {} as never, requestApproval: async () => true,
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.servers[0]).toMatchObject({ id: 's', prefix: 's', auth: { scheme: 'bearer' } });
    expect((ctx?.servers[0] as Record<string, unknown>).tools).toBeDefined();
    // no sealed `key` leaks into the active descriptor's auth
    expect((ctx?.servers[0].auth as Record<string, unknown>).key).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/build-mcp-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `build-mcp-context.ts`**

```ts
// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import type { McpServerRow } from '../boot/client-data-db.js';
import { openMcpKey } from '../data/mcp-servers.js';
import type { McpActiveServer, McpToolContext } from './mcp-tools.js';
import { resolveActiveServers } from './resolve-active.js';

export interface BuildMcpContextArgs {
  servers: McpServerRow[];
  overrides: Record<string, 'on' | 'off'>;
  hasProxy: boolean;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  mk: MasterKey | null;
  requestApproval: McpToolContext['requestApproval'];
}

/** Assemble the per-send MCP context, or null when no server is active. */
export function buildMcpContext(args: BuildMcpContextArgs): McpToolContext | null {
  const active = resolveActiveServers(args.servers, args.overrides, args.hasProxy);
  if (active.length === 0) return null;

  const byId = new Map(active.map((s) => [s.id, s]));
  const servers: McpActiveServer[] = active.map((s) => ({
    id: s.id,
    name: s.name,
    prefix: s.prefix,
    // biome-ignore lint/style/noNonNullAssertion: resolveActiveServers guarantees these
    routing: s.routing!,
    // biome-ignore lint/style/noNonNullAssertion: resolveActiveServers guarantees these
    resolvedEndpoint: s.resolvedEndpoint!,
    auth: s.auth ? (s.auth.scheme === 'bearer' ? { scheme: 'bearer' } : { scheme: 'header', headerName: s.auth.headerName }) : null,
    autoRun: s.autoRun,
    tools: s.tools,
    hiddenTools: s.hiddenTools,
  }));

  return {
    servers,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
    getServerKey: async (serverId) => {
      const row = byId.get(serverId);
      if (!row || !args.mk) return null;
      return openMcpKey(row, args.mk);
    },
    requestApproval: args.requestApproval,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp/build-mcp-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread it through the send path**

In `send-message.ts`, where the knowledge context is assembled, also read the MCP servers + the persona's `mcpOverrides`, build the context, and pass it to the stream-manager (add an `mcp` field to the args object the stream-manager receives). Use:

```ts
import { buildMcpContext } from '../mcp/build-mcp-context.js';
import { useMcpApprovalStore } from '../state/mcp-approval.store.js';
// ...
const mcpServers = await getClientDataDb().mcpServers.toArray();
const mcp = buildMcpContext({
  servers: mcpServers,
  overrides: persona.mcpOverrides ?? {},
  hasProxy: corsProxy != null,
  corsProxyUrl: corsProxy?.url ?? null,
  corsProxyKey: corsProxyKeyPlaintext ?? null, // the same decrypted proxy key the LLM path uses
  mk,
  requestApproval: (req) => useMcpApprovalStore.getState().request(req),
});
// pass `mcp` into the stream-manager args alongside `knowledge`
```

(Match the exact names `send-message.ts` already uses for `persona`, `mk`, the decrypted CORS proxy URL + key. Read the file first.)

In `stream-manager.store.ts`, add `mcp` to the args type and pass it as the fourth argument:

```ts
const activeTools = toolsActive ? resolveActiveTools(integrationCtx, knowledge, expert, args.mcp ?? null) : [];
```

- [ ] **Step 6: Typecheck + the touched suites**

Run: `pnpm typecheck`
Expected: green.
Run: `pnpm --filter @chatsundere/user-client exec vitest run src/mcp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/user-client/src/mcp/build-mcp-context.ts apps/user-client/src/mcp/build-mcp-context.test.ts apps/user-client/src/data/send-message.ts apps/user-client/src/state/stream-manager.store.ts
git commit -m "Build and thread the MCP tool context through the send path"
```

---

## Task 9: Settings — MCP Servers section + server sheet

**Files:**
- Create: `apps/user-client/src/components/mcp/McpServersSection.tsx`
- Create: `apps/user-client/src/components/mcp/McpServerSheet.tsx`
- Modify: `apps/user-client/src/routes/app/settings.tsx` (mount a new `AccordionCard`)
- Test: `apps/user-client/src/components/mcp/McpServersSection.test.tsx`

Mirror `ProvidersSection` / `ProviderSheet` (read them). The section lists servers with a status badge (`● Connected (direct)` / `● Connected (via proxy)` / `✗ Needs proxy` / `✗ Not tested` / `✗ <lastError>`), an `onByDefault` toggle, and an `+ Add MCP server` button opening the sheet. The sheet edits name, URL, auth (Bearer key or custom header name + value), prefix (default `sanitiseToolName(name)`), `onByDefault`, `autoRun`, a **Test connection** button (calls `testMcpConnection`, writes `routing`/`resolvedEndpoint`/`tools`/`lastError`), a tool list with per-tool hide checkboxes, and Save/Delete.

- [ ] **Step 1: Mount the accordion in `settings.tsx`**

Add the import:

```tsx
import { McpServersSection } from '../../components/mcp/McpServersSection.js';
```

Add, after the Expert uplink `AccordionCard` (line ~430):

```tsx
      <AccordionCard icon="⧉" label="MCP Servers" meta="External tool servers">
        <McpServersSection />
      </AccordionCard>
```

- [ ] **Step 2: Failing test for the section (rendering + add affordance)**

`apps/user-client/src/components/mcp/McpServersSection.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { McpServersSection } from './McpServersSection.js';

vi.mock('../../data/mcp-servers.js', () => ({
  useMcpServers: () => ({ data: [] }),
  useUpsertMcpServer: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteMcpServer: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../data/settings.js', () => ({ useSettings: () => ({ data: { corsProxy: null } }) }));

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('McpServersSection', () => {
  it('shows an empty state and an add button when there are no servers', () => {
    render(wrap(<McpServersSection />));
    expect(screen.getByRole('button', { name: /add mcp server/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2b: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/mcp/McpServersSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `McpServersSection.tsx`**

Mirror `ProvidersSection` structure. Use `useMcpServers`, `useSettings` (for `hasProxy`), local `useState` for the open sheet (`McpServerRow | 'new' | null`). Render the list with a `statusOf(row)` helper:

```tsx
function statusOf(row: McpServerRow, hasProxy: boolean): string {
  if (!row.enabled) return '✗ Disabled';
  if (row.routing === null) return '✗ Not tested';
  if (row.routing === 'proxy' && !hasProxy) return '✗ Needs proxy';
  if (row.lastError) return `✗ ${row.lastError}`;
  return row.routing === 'proxy' ? '● Connected (via proxy)' : '● Connected (direct)';
}
```

Include an `onByDefault` toggle per row (calls `useUpsertMcpServer().mutate({ ...row, onByDefault: !row.onByDefault, updatedAt: Date.now() })`), an `+ Add MCP server` button (`setOpenSheet('new')`), and the egress note:

```tsx
<p className="text-[11px] text-paper-soft">
  MCP tools run on external servers. Each call sends its arguments — which may include
  parts of your conversation — to that server. Tools wait for your approval unless you
  mark a server as trusted.
</p>
```

Render `<McpServerSheet>` when `openSheet` is set.

- [ ] **Step 4: Implement `McpServerSheet.tsx`**

Read `ProviderSheet.tsx` for the sheet shell + the seal pattern. The sheet:
- Local draft state for name/url/prefix/auth-scheme/header-name/key/onByDefault/autoRun.
- **Test connection** button: resolves the decrypted proxy creds (read `useSettings().data.corsProxy`; the shared key needs `openSecret(corsProxy.sharedKey, mk, 'cors-proxy/shared-key')` — match how `CorsProxyBlock`/the send path opens it), builds the resolved auth (`{header,value}` from the entered key, sealed only on save but used in plaintext for the test), calls `testMcpConnection({ url, hasProxy, corsProxy, auth })`, and on result writes `routing`/`resolvedEndpoint`/`tools`/`lastTestedAt`/`lastError` into the draft (shows the tool list + any error).
- **Save**: seals the key with `sealMcpKey(plaintext, mk, serverId)` (use the same two-step stable-slot pattern as `ProviderSheet` so the slot matches the row id), persists via `useUpsertMcpServer`.
- Tool list: a checkbox per `draft.tools[i]` toggling membership in `hiddenTools`.
- Prefix field defaulting to `sanitiseToolName(name)` until the user edits it.
- Delete via `useDeleteMcpServer`.

Use `sealMcpKey` / `openMcpKey` from `data/mcp-servers.js`, `sanitiseToolName` from `mcp/tool-naming.js`, `testMcpConnection` from `mcp/mcp-connectivity.js`, and the MasterKey from the session store (mirror how `ProviderSheet` reads `mk`).

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/mcp/McpServersSection.test.tsx`
Expected: PASS.
Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/mcp/ apps/user-client/src/routes/app/settings.tsx
git commit -m "Add MCP Servers settings section and server sheet"
```

---

## Task 10: Persona editor — MCP override sub-section

**Files:**
- Create: `apps/user-client/src/components/persona-editor/McpOverrideSection.tsx`
- Modify: `apps/user-client/src/routes/app/persona-editor.tsx` (mount it + include `mcpOverrides` in `defaultDraft`)
- Test: `apps/user-client/src/components/persona-editor/McpOverrideSection.test.tsx`

Mirror `KnowledgeSection.tsx` (read it). The section lists every enabled MCP server with a **tri-state** control per server — `Default (on/off)` / `On` / `Off` — writing into `draft.mcpOverrides`. "Default" removes the key from the map; "On"/"Off" set it.

- [ ] **Step 1: Failing test (tri-state mapping)**

`apps/user-client/src/components/persona-editor/McpOverrideSection.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { McpOverrideSection } from './McpOverrideSection.js';

const servers = [
  { id: 's1', name: 'GitHub', onByDefault: true, enabled: true },
  { id: 's2', name: 'Files', onByDefault: false, enabled: true },
] as never[];

describe('McpOverrideSection', () => {
  it('"Off" on a default-on server records an off override', async () => {
    const onChange = vi.fn();
    render(<McpOverrideSection servers={servers} overrides={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /github.*off/i }));
    expect(onChange).toHaveBeenCalledWith({ s1: 'off' });
  });

  it('"Default" clears an existing override', async () => {
    const onChange = vi.fn();
    render(<McpOverrideSection servers={servers} overrides={{ s1: 'off' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /github.*default/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
```

(Adjust the accessible-name matchers to the actual control markup you implement — segmented buttons labelled per server.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/persona-editor/McpOverrideSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `McpOverrideSection.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
interface ServerLite { id: string; name: string; onByDefault: boolean; enabled: boolean }

export function McpOverrideSection(props: {
  servers: ServerLite[];
  overrides: Record<string, 'on' | 'off'>;
  onChange: (next: Record<string, 'on' | 'off'>) => void;
}): JSX.Element {
  const enabled = props.servers.filter((s) => s.enabled);
  const set = (id: string, value: 'default' | 'on' | 'off') => {
    const next = { ...props.overrides };
    if (value === 'default') delete next[id];
    else next[id] = value;
    props.onChange(next);
  };
  if (enabled.length === 0) {
    return <p className="text-[11px] text-paper-soft">No MCP servers configured. Add one in My Settings → MCP Servers.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {enabled.map((s) => {
        const current = props.overrides[s.id] ?? 'default';
        return (
          <div key={s.id} className="flex items-center justify-between gap-2">
            <span className="text-sm text-paper">{s.name}</span>
            <div className="flex gap-1">
              {(['default', 'on', 'off'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={current === v}
                  aria-label={`${s.name} ${v}`}
                  onClick={() => set(s.id, v)}
                  className={current === v ? 'rounded bg-white/10 px-2 py-1 text-xs text-paper' : 'rounded px-2 py-1 text-xs text-paper-soft'}
                >
                  {v === 'default' ? `Default (${s.onByDefault ? 'on' : 'off'})` : v === 'on' ? 'On' : 'Off'}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Mount in `persona-editor.tsx`**

Add `mcpOverrides: {}` to the `defaultDraft(...)` return object. Add the import + a `useMcpServers()` call, and an `AccordionCard` near the `KnowledgeSection` mount:

```tsx
import { McpOverrideSection } from '../../components/persona-editor/McpOverrideSection.js';
import { useMcpServers } from '../../data/mcp-servers.js';
// inside the component:
const mcpServers = useMcpServers();
// in the JSX, near KnowledgeSection:
<AccordionCard icon="⧉" label="MCP Servers" meta="Per-persona tool access">
  <McpOverrideSection
    servers={mcpServers.data ?? []}
    overrides={draft.mcpOverrides}
    onChange={(next) => patchDraft({ mcpOverrides: next })}
  />
</AccordionCard>
```

(Match the editor's actual draft-patch helper name — read the file; it may be `setDraft((d) => ...)` rather than `patchDraft`.)

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/persona-editor/McpOverrideSection.test.tsx`
Expected: PASS.
Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/persona-editor/McpOverrideSection.tsx apps/user-client/src/components/persona-editor/McpOverrideSection.test.tsx apps/user-client/src/routes/app/persona-editor.tsx
git commit -m "Add per-persona MCP override section"
```

---

## Task 11: Approval prompt UI

**Files:**
- Create: `apps/user-client/src/components/mcp/McpApprovalPrompt.tsx`
- Modify: the chat page (`apps/user-client/src/routes/app/chat-page.tsx` or equivalent) to mount it
- Test: `apps/user-client/src/components/mcp/McpApprovalPrompt.test.tsx`

A simple centred modal (NOT a tap-dismissable overlay — avoids the `InteractionMode` outside-tap footgun) that renders the first pending approval: server name, tool name, pretty-printed args, **Approve** / **Deny**, and a secondary "Always allow this server" that flips the server's `autoRun` then approves.

- [ ] **Step 1: Failing test**

`apps/user-client/src/components/mcp/McpApprovalPrompt.test.tsx`:

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useMcpApprovalStore } from '../../state/mcp-approval.store.js';
import { McpApprovalPrompt } from './McpApprovalPrompt.js';

beforeEach(() => useMcpApprovalStore.setState({ pending: [] }));

describe('McpApprovalPrompt', () => {
  it('renders nothing when there is no pending request', () => {
    const { container } = render(<McpApprovalPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('approves the pending request', async () => {
    const p = useMcpApprovalStore.getState().request({ serverId: 's', serverName: 'GitHub', toolName: 'search', args: { q: 'x' } });
    render(<McpApprovalPrompt />);
    expect(screen.getByText(/GitHub/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await expect(p).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/mcp/McpApprovalPrompt.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `McpApprovalPrompt.tsx`**

```tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { useMcpServers, useUpsertMcpServer } from '../../data/mcp-servers.js';
import { useMcpApprovalStore } from '../../state/mcp-approval.store.js';

export function McpApprovalPrompt(): JSX.Element | null {
  const pending = useMcpApprovalStore((s) => s.pending);
  const approve = useMcpApprovalStore((s) => s.approve);
  const deny = useMcpApprovalStore((s) => s.deny);
  const servers = useMcpServers();
  const upsert = useUpsertMcpServer();
  const req = pending[0];
  if (!req) return null;

  const trustAndApprove = () => {
    const row = (servers.data ?? []).find((s) => s.id === req.serverId);
    if (row) upsert.mutate({ ...row, autoRun: true, updatedAt: Date.now() });
    approve(req.id);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-ink p-4">
        <div className="mb-1 font-display text-sm text-paper">
          {req.serverName} wants to run <span className="font-mono">{req.toolName}</span>
        </div>
        <pre className="mb-3 max-h-40 overflow-auto rounded bg-white/5 p-2 text-[11px] text-paper-soft">
          {JSON.stringify(req.args, null, 2)}
        </pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => approve(req.id)} className="rounded bg-white/10 px-3 py-1.5 text-sm text-paper">
            Approve
          </button>
          <button type="button" onClick={() => deny(req.id)} className="rounded px-3 py-1.5 text-sm text-paper-soft">
            Deny
          </button>
          <button type="button" onClick={trustAndApprove} className="ml-auto rounded px-3 py-1.5 text-xs text-paper-soft">
            Always allow {req.serverName}
          </button>
        </div>
      </div>
    </div>
  );
}
```

(Match the actual Tailwind colour tokens used elsewhere — e.g. `bg-ink`/`text-paper` may differ; copy from a sibling modal.)

- [ ] **Step 4: Mount it on the chat page**

Read the chat page and add `<McpApprovalPrompt />` at the page root (it self-hides when idle). Import:

```tsx
import { McpApprovalPrompt } from '../../components/mcp/McpApprovalPrompt.js';
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @chatsundere/user-client exec vitest run src/components/mcp/McpApprovalPrompt.test.tsx`
Expected: PASS.
Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/user-client/src/components/mcp/McpApprovalPrompt.tsx apps/user-client/src/components/mcp/McpApprovalPrompt.test.tsx apps/user-client/src/routes/app/chat-page.tsx
git commit -m "Add MCP tool-call approval prompt UI"
```

---

## Task 12: Security log, egress note, Larissa, full verification, STATUS

**Files:**
- Modify: `obsidian/insights/security-deferrals.md`
- Modify: `obsidian/STATUS-CLIENT-ONLY.md`

- [ ] **Step 1: Log the egress in `security-deferrals.md`**

Append an entry: new outbound egress surface — MCP tool-call arguments (potentially conversation content) leave the device to user-configured third-party MCP servers; credentials sealed with the MasterKey (slot `mcp/<id>/api-key`), opened only at call time; the approval gate (per-server `autoRun` opt-out) is the user-consent control; the connection test exposes direct-vs-proxy routing and allowlist/session-header proxy gaps. British English.

- [ ] **Step 2: Summon Larissa (security audit)**

This is Liz's responsibility, not a subagent step — summon Larissa per CLAUDE.md §9 with the diff and this spec. Focus: (a) credential sealing/opening cannot leak plaintext or use a wrong slot; (b) the approval gate cannot be bypassed and a deny truly aborts the call (no fall-through to `mcpToolsCall`); (c) the egress surface is exactly as documented (no conversation/persona data beyond the tool arguments the model chose). Fix findings; log any conscious deferrals.

- [ ] **Step 3: Full verification (on the branch, before squash)**

```bash
pnpm typecheck
pnpm --filter @chatsundere/user-client exec vitest run
pnpm run build
pnpm biome check .
```

Expected: typecheck green; user-client vitest at the master baseline (the known pre-existing `cockpit-draft`/`chat-page`/`chat-route` localStorage-jsdom failures only — verify they are identical on master, per the per-task-review lesson) plus all new MCP tests passing; build 9/9; biome clean.

- [ ] **Step 4: Update `STATUS-CLIENT-ONLY.md`**

Add the MCP-client landing entry (what shipped, Dexie v17, the proxy allowlist/session-header device-verification items, spec/plan links, the device checklist from spec §14). Refresh the `Last updated:` line and the "Next session" block.

- [ ] **Step 5: Commit**

```bash
git add obsidian/insights/security-deferrals.md obsidian/STATUS-CLIENT-ONLY.md
git commit -m "Log MCP egress, run security audit, update STATUS [skip ci]"
```

---

## Manual verification (device — Liz hands to Chris)

Run the spec §14 checklist on device: a stateless public server (direct); a proxy-only server (allowlist + session-header behaviour of `cors-proxy.tidesson.net`); a `/mcp`-suffix discovery; a cross-server tool-name collision; the default + per-persona override matrix; the approval prompt (deny / approve / "always allow"); prefix edit + tool hide; a custom-header auth server; and a **multi-turn** loop (the companion answers from the tool result in its own voice). The proxy allowlist must include each `proxy`-routed server's host.

---

## Self-review notes (filled by the plan author)

- **Spec coverage:** D1 (Task 3 connection test), D2 (Task 1 prefixing), D3 (Task 3 variants), D4 (Task 4 resolve-active + Task 10 overrides), D5 (Task 5 store + Task 6 gate + Task 11 UI), D6 tools-only (no resources/prompts anywhere), D7 (Task 9 sheet auth), D8 no cockpit chip (none added), D9 user-client (all paths under apps/user-client), D10 Larissa (Task 12). Dexie v17 (Task 4). Proxy risk surfaced (Task 3 errors, Task 9 status, Task 12 device check).
- **Type consistency:** `McpEndpoint`, `McpToolDefinition`, `McpAuthResolved`, `McpToolContext`, `McpActiveServer`, `McpServerRow`, `resolveActiveServers`, `contributeMcpTools`, `buildMcpContext`, `mcpToolsCall`/`mcpToolsList`, `testMcpConnection`/`buildCandidates`/`resolveConnection` — names used consistently across tasks.
