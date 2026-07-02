// SPDX-License-Identifier: AGPL-3.0-only
import { fetchWithProxyAuth, getProxyAuthSource } from '@chatsundere/llm-unified';
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

const sessions = new Map<
  string,
  { sessionId: string | null; initialising?: Promise<string | null> }
>();

/** Test helper — clears the session cache and request counter. */
export function __resetMcpSessions(): void {
  sessions.clear();
  requestId = 0;
}

function buildRequest(endpoint: McpEndpoint, body: unknown, sessionId: string | null): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  });
  if (endpoint.auth) headers.set(endpoint.auth.header, endpoint.auth.value);
  if (sessionId) headers.set('Mcp-Session-Id', sessionId);

  let url: string;
  // Direct requests follow redirects; a proxied request must never chase an
  // upstream redirect off-proxy (spec §5).
  let redirect: RequestInit['redirect'] = 'follow';
  if (endpoint.routing === 'direct') {
    url = endpoint.url;
  } else {
    const source = getProxyAuthSource();
    const proxyUrl = source?.getUrl() ?? null;
    const token = source?.getToken() ?? null;
    if (proxyUrl === null || token === null)
      throw new Error('MCP proxy routing selected but the linked server proxy is unavailable');
    const target = new URL(endpoint.url);
    headers.set('x-chatsundere-authorization', `Bearer ${token}`);
    headers.set('x-cors-proxy-target', target.origin);
    url = joinUrl(proxyUrl, target.pathname + target.search);
    redirect = 'manual';
  }
  // Signal is passed to fetch() rather than Request() to avoid cross-realm
  // AbortSignal instanceof checks that fail in jsdom and some bundler environments.
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body), redirect });
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/** Reads a JSON-RPC reply from either an application/json or text/event-stream response. */
export async function readJsonRpcResponse(
  resp: Response,
  expectedId?: number,
): Promise<JsonRpcReply> {
  const ctype = ((resp.headers.get('content-type') ?? '').split(';')[0] ?? '').trim().toLowerCase();
  if (ctype === 'application/json') return (await resp.json()) as JsonRpcReply;
  if (ctype === 'text/event-stream') {
    if (!resp.body) throw new Error('SSE response has no body');
    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl = buffer.indexOf('\n');
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) {
          const data = line.slice(5).trimStart();
          if (data) {
            try {
              const obj = JSON.parse(data) as JsonRpcReply;
              if (expectedId === undefined || obj.id === expectedId) return obj;
            } catch {
              // malformed SSE line — skip and continue
            }
          }
        }
        nl = buffer.indexOf('\n');
      }
    }
    throw new Error('SSE stream closed without a matching response');
  }
  throw new Error(`Unexpected content-type from MCP server: ${ctype}`);
}

async function doInitialise(endpoint: McpEndpoint, signal?: AbortSignal): Promise<string | null> {
  const proxied = endpoint.routing === 'proxy';
  const initId = nextId();
  const initResp = await fetchWithProxyAuth(
    () =>
      buildRequest(
        endpoint,
        {
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          },
        },
        null,
      ),
    { proxied, signal },
  );
  if (!initResp.ok) throw new Error(`MCP initialise failed: HTTP ${initResp.status}`);
  const sessionId = initResp.headers.get('mcp-session-id');
  try {
    await readJsonRpcResponse(initResp, initId);
  } catch {
    /* session-id header is what matters here */
  }
  await fetchWithProxyAuth(
    () =>
      buildRequest(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId),
    { proxied, signal },
  );
  return sessionId;
}

async function ensureSession(endpoint: McpEndpoint, signal?: AbortSignal): Promise<string | null> {
  const existing = sessions.get(endpoint.url);
  if (existing && existing.sessionId !== undefined && !existing.initialising)
    return existing.sessionId;
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

/** Fetches the list of tools advertised by the MCP server. */
export async function mcpToolsList(
  endpoint: McpEndpoint,
  timeoutMs = 10_000,
): Promise<McpToolDefinition[]> {
  const sessionId = await ensureSession(endpoint, AbortSignal.timeout(timeoutMs));
  const listId = nextId();
  const resp = await fetchWithProxyAuth(
    () => buildRequest(endpoint, { jsonrpc: '2.0', id: listId, method: 'tools/list' }, sessionId),
    { proxied: endpoint.routing === 'proxy', signal: AbortSignal.timeout(timeoutMs) },
  );
  if (!resp.ok) {
    if (resp.status === 404) sessions.delete(endpoint.url);
    throw new Error(`MCP tools/list failed: HTTP ${resp.status}`);
  }
  const body = await readJsonRpcResponse(resp);
  if (body.error) throw new Error(body.error.message || 'tools/list error');
  const result = (body.result ?? {}) as { tools?: McpToolDefinition[] };
  return result.tools ?? [];
}

/** Invokes a named tool on the MCP server and returns its text output. */
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
    return {
      stdout: '',
      error: `MCP initialise failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const callOnce = (sid: string | null): Promise<Response> => {
    const callId = nextId();
    return fetchWithProxyAuth(
      () =>
        buildRequest(
          endpoint,
          {
            jsonrpc: '2.0',
            id: callId,
            method: 'tools/call',
            params: { name: toolName, arguments: args },
          },
          sid,
        ),
      { proxied: endpoint.routing === 'proxy', signal: signal ?? AbortSignal.timeout(timeoutMs) },
    );
  };

  let resp: Response;
  try {
    resp = await callOnce(sessionId);
    if (resp.status === 404 && sessionId) {
      // Session expired — reinitialise and retry once.
      sessions.delete(endpoint.url);
      sessionId = await ensureSession(endpoint, signal);
      resp = await callOnce(sessionId);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      return { stdout: '', error: `MCP server timed out after ${timeoutMs}ms` };
    return {
      stdout: '',
      error: `MCP server unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!resp.ok) return { stdout: '', error: `MCP server returned HTTP ${resp.status}` };

  let body: JsonRpcReply;
  try {
    body = await readJsonRpcResponse(resp);
  } catch (e) {
    return {
      stdout: '',
      error: `MCP response read failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (body.error) return { stdout: '', error: `MCP error: ${body.error.message || 'unknown'}` };

  const result = (body.result ?? {}) as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (result.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  if (result.isError) return { stdout: '', error: text || 'Tool returned an error' };
  return { stdout: text, error: null };
}
