// SPDX-License-Identifier: AGPL-3.0-only
import { ProxyRedirectError, getProxyAuthSource, isOpaqueRedirect } from '@chatsundere/llm-unified';
import { isProxyUnauthorised } from './oauth/oauth-fetch.js';
import { type ParsedChallenge, parseBearerChallenge } from './oauth/www-authenticate.js';
import { MCP_PROTOCOL_VERSION } from './protocol.js';
import type { McpEndpoint, McpToolDefinition } from './types.js';

export { MCP_PROTOCOL_VERSION } from './protocol.js';

/**
 * The upstream refused the call's credentials: a 401, or a 403 whose challenge says
 * `insufficient_scope`. The message never carries the request or its headers.
 */
export class McpAuthRequiredError extends Error {
  readonly status: 401 | 403;
  readonly challenge: ParsedChallenge | null;

  constructor(message: string, status: 401 | 403, challenge: ParsedChallenge | null) {
    super(message);
    this.name = 'McpAuthRequiredError';
    this.status = status;
    this.challenge = challenge;
  }
}

/**
 * The linked Chatsundere server refused the account token, even after a refresh. This is
 * not the MCP server's answer, so it must never spend the MCP grant's refresh token.
 */
export class McpProxySessionError extends Error {
  constructor() {
    super('Your Chatsundere server session has expired. Unlock or sign in to Chatsundere again.');
    this.name = 'McpProxySessionError';
  }
}

/** The auth signal of a response, or null when it is not an auth failure. */
function authFailure(
  resp: Response,
): { status: 401 | 403; challenge: ParsedChallenge | null } | null {
  if (resp.status !== 401 && resp.status !== 403) return null;
  const header = resp.headers.get('www-authenticate');
  const challenge = header ? parseBearerChallenge(header) : null;
  if (resp.status === 401) return { status: 401, challenge };
  return challenge?.error === 'insufficient_scope' ? { status: 403, challenge } : null;
}

const CLIENT_INFO = { name: 'chatsundere', version: '0.1.0' };

interface JsonRpcReply {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

let requestId = 0;
const nextId = (): number => ++requestId;

/** An initialised session: its id, if the server issued one, and the negotiated version. */
interface McpSession {
  sessionId: string | null;
  protocolVersion: string;
}

const sessions = new Map<string, { session?: McpSession; initialising?: Promise<McpSession> }>();

/** Test helper — clears the session cache and request counter. */
export function __resetMcpSessions(): void {
  sessions.clear();
  requestId = 0;
}

/** `session` is null only for `initialize` itself, which carries no session headers. */
function buildRequest(endpoint: McpEndpoint, body: unknown, session: McpSession | null): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  });
  if (endpoint.auth) headers.set(endpoint.auth.header, endpoint.auth.value);
  if (session?.sessionId) headers.set('Mcp-Session-Id', session.sessionId);
  // Required on every request after initialise by the 2025-06-18 Streamable HTTP transport.
  if (session) headers.set('MCP-Protocol-Version', session.protocolVersion);

  let url: string;
  // A proxied request must never chase an upstream redirect off-proxy (spec §5), and a
  // direct one carrying a credential must not hand it to wherever a redirect points.
  let redirect: RequestInit['redirect'] = endpoint.auth ? 'error' : 'follow';
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
    headers.set('x-cors-proxy-kind', 'mcp');
    url = joinUrl(proxyUrl, target.pathname + target.search);
    redirect = 'manual';
  }
  // Signal is passed to fetch() rather than Request() to avoid cross-realm
  // AbortSignal instanceof checks that fail in jsdom and some bundler environments.
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body), redirect });
}

/**
 * Sends one MCP request. Through the proxy, only the proxy's own `unauthorized` refusal
 * of the account token earns a refresh and one resend: an upstream 401 is the server's
 * answer and is returned as-is, so it goes over the wire exactly once. This is why MCP
 * does not use `fetchWithProxyAuth`, which resends on any 401.
 */
async function send(
  build: () => Request,
  opts: { proxied: boolean; signal?: AbortSignal },
): Promise<Response> {
  const init = opts.signal ? { signal: opts.signal } : undefined;
  let response = await fetch(build(), init);
  if (!opts.proxied) return response;
  if (await isProxyUnauthorised(response)) {
    const token = await getProxyAuthSource()?.refreshToken();
    if (token !== null && token !== undefined) {
      await response.body?.cancel();
      response = await fetch(build(), init);
    }
    if (await isProxyUnauthorised(response)) {
      void response.body?.cancel().catch(() => undefined);
      throw new McpProxySessionError();
    }
  }
  if (isOpaqueRedirect(response)) throw new ProxyRedirectError();
  return response;
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

async function doInitialise(endpoint: McpEndpoint, signal?: AbortSignal): Promise<McpSession> {
  const proxied = endpoint.routing === 'proxy';
  const initId = nextId();
  const initResp = await send(
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
  if (!initResp.ok) {
    const auth = authFailure(initResp);
    const message = `MCP initialise failed: HTTP ${initResp.status}`;
    void initResp.body?.cancel().catch(() => undefined);
    if (auth) throw new McpAuthRequiredError(message, auth.status, auth.challenge);
    throw new Error(message);
  }
  const sessionId = initResp.headers.get('mcp-session-id');
  let protocolVersion = MCP_PROTOCOL_VERSION;
  try {
    const reply = await readJsonRpcResponse(initResp, initId);
    const negotiated = (reply.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
    // The header must carry the version the server agreed to, which may be older than ours.
    if (typeof negotiated === 'string' && negotiated !== '') protocolVersion = negotiated;
  } catch {
    /* session-id header is what matters here */
  }
  const session: McpSession = { sessionId, protocolVersion };
  await send(
    () => buildRequest(endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, session),
    { proxied, signal },
  );
  return session;
}

async function ensureSession(endpoint: McpEndpoint, signal?: AbortSignal): Promise<McpSession> {
  const existing = sessions.get(endpoint.url);
  if (existing?.session) return existing.session;
  if (existing?.initialising) return existing.initialising;
  const initPromise = doInitialise(endpoint, signal);
  sessions.set(endpoint.url, { initialising: initPromise });
  try {
    const session = await initPromise;
    sessions.set(endpoint.url, { session });
    return session;
  } catch (e) {
    sessions.delete(endpoint.url);
    throw e;
  }
}

/** Fetches the list of tools advertised by the MCP server. */
export async function mcpToolsList(
  endpoint: McpEndpoint,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<McpToolDefinition[]> {
  const withTimeout = () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };
  const session = await ensureSession(endpoint, withTimeout());
  const listId = nextId();
  const resp = await send(
    () => buildRequest(endpoint, { jsonrpc: '2.0', id: listId, method: 'tools/list' }, session),
    { proxied: endpoint.routing === 'proxy', signal: withTimeout() },
  );
  if (!resp.ok) {
    if (resp.status === 404) sessions.delete(endpoint.url);
    const auth = authFailure(resp);
    const message = `MCP tools/list failed: HTTP ${resp.status}`;
    void resp.body?.cancel().catch(() => undefined);
    if (auth) throw new McpAuthRequiredError(message, auth.status, auth.challenge);
    throw new Error(message);
  }
  const body = await readJsonRpcResponse(resp);
  if (body.error) throw new Error(body.error.message || 'tools/list error');
  const result = (body.result ?? {}) as { tools?: McpToolDefinition[] };
  return result.tools ?? [];
}

/** The outcome of one tool call; `auth` is set when the upstream refused the credentials. */
export interface McpCallResult {
  stdout: string;
  error: string | null;
  auth?: 'required' | 'insufficient-scope';
  scope?: string;
}

function authResult(
  error: string,
  status: 401 | 403,
  challenge: ParsedChallenge | null,
): McpCallResult {
  if (status === 401) return { stdout: '', error, auth: 'required' };
  return {
    stdout: '',
    error,
    auth: 'insufficient-scope',
    ...(challenge?.scope ? { scope: challenge.scope } : {}),
  };
}

/** Invokes a named tool on the MCP server and returns its text output. */
export async function mcpToolsCall(
  endpoint: McpEndpoint,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  // The caller's signal is the user's Stop button; it must not replace the
  // timeout, or a hung server blocks the whole turn until someone presses Stop.
  const timeout = AbortSignal.timeout(timeoutMs);
  const callSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let session: McpSession;
  try {
    session = await ensureSession(endpoint, callSignal);
  } catch (e) {
    if (e instanceof McpAuthRequiredError) return authResult(e.message, e.status, e.challenge);
    if (e instanceof McpProxySessionError) return { stdout: '', error: e.message };
    if (e instanceof DOMException && e.name === 'TimeoutError')
      return { stdout: '', error: `MCP server timed out after ${timeoutMs}ms` };
    return {
      stdout: '',
      error: `MCP initialise failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const callOnce = (current: McpSession): Promise<Response> => {
    const callId = nextId();
    return send(
      () =>
        buildRequest(
          endpoint,
          {
            jsonrpc: '2.0',
            id: callId,
            method: 'tools/call',
            params: { name: toolName, arguments: args },
          },
          current,
        ),
      { proxied: endpoint.routing === 'proxy', signal: callSignal },
    );
  };

  let resp: Response;
  try {
    resp = await callOnce(session);
    if (resp.status === 404 && session.sessionId) {
      // Session expired — reinitialise and retry once.
      sessions.delete(endpoint.url);
      session = await ensureSession(endpoint, callSignal);
      resp = await callOnce(session);
    }
  } catch (e) {
    if (e instanceof McpAuthRequiredError) return authResult(e.message, e.status, e.challenge);
    if (e instanceof McpProxySessionError) return { stdout: '', error: e.message };
    if (e instanceof DOMException && e.name === 'TimeoutError')
      return { stdout: '', error: `MCP server timed out after ${timeoutMs}ms` };
    return {
      stdout: '',
      error: `MCP server unreachable: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!resp.ok) {
    const auth = authFailure(resp);
    const error = `MCP server returned HTTP ${resp.status}`;
    void resp.body?.cancel().catch(() => undefined);
    return auth ? authResult(error, auth.status, auth.challenge) : { stdout: '', error };
  }

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
