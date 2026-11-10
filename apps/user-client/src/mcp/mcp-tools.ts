// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool, ToolProgress, ToolResult } from '../tools/types.js';
import { type McpCallResult, mcpToolsCall } from './mcp-client.js';
import type { EnsureResult } from './oauth/ensure-token.js';
import { canonicalResource } from './oauth/url.js';
import { buildMcpToolNames } from './tool-naming.js';
import type {
  McpAuthResolved,
  McpAuthSignal,
  McpEndpoint,
  McpRouting,
  McpToolDefinition,
} from './types.js';

/**
 * Upper bound for one MCP tool call. Agentic servers run real work (searches,
 * shell-like commands), so this is a hung-server guard rather than a latency goal.
 */
const MCP_CALL_TIMEOUT_MS = 120_000;

/** One server resolved active for this send (no plaintext key — opened lazily). */
export interface McpActiveServer {
  id: string;
  name: string;
  prefix: string;
  /** The user-entered URL; for an OAuth server, the grant's resource. */
  url: string;
  /** Null until probed on this device; resolved on first use. */
  routing: McpRouting | null;
  resolvedEndpoint: string | null;
  auth:
    | { scheme: 'bearer' }
    | { scheme: 'header'; headerName: string }
    | { scheme: 'oauth' }
    | null;
  autoRun: boolean;
  /** Whether this device's user agreed to contact this server at its current URL. */
  hasConsent: boolean;
  tools: McpToolDefinition[];
  hiddenTools: string[];
}

/**
 * A token result: `mismatch` when the grant does not belong to the row (the chokepoint),
 * `not-oauth` when the server does not sign in with OAuth at all.
 */
export type McpTokenResult = EnsureResult | { ok: false; reason: 'mismatch' | 'not-oauth' };

/** The chat notice a failed OAuth call asks for; one per server per send. */
export interface McpAuthNotice {
  serverId: string;
  serverName: string;
  variant: 'dead' | 'held' | 'waiting' | 'scope';
  scope?: string;
}

/** Per-send MCP context: the active servers plus the key opener and approval hook. */
export interface McpToolContext {
  servers: McpActiveServer[];
  /** Opens a server's plaintext key (MasterKey-gated) at call time, or null. */
  getServerKey: (serverId: string) => Promise<string | null>;
  /** A usable access token for an OAuth server, through the token chokepoint. Never throws. */
  getOAuthToken: (
    serverId: string,
    opts?: { rejectedToken?: string; signal?: AbortSignal; onWaiting?: () => void },
  ) => Promise<McpTokenResult>;
  /** Surfaces an approval request and resolves with the user's decision. */
  requestApproval: (req: {
    serverId: string;
    serverName: string;
    toolName: string;
    args: Record<string, unknown>;
    host: string;
    firstUse: boolean;
  }) => Promise<boolean>;
  /** Asks whether this device may contact a server under autoRun for the first time. */
  requestFirstUse: (req: {
    serverId: string;
    serverName: string;
    host: string;
  }) => Promise<boolean>;
  /** Remembers on this device that the user agreed to contact the server at `url`. */
  recordConsent: (serverId: string, url: string) => Promise<void>;
  /** Probes a server this device has no route to yet, and remembers the outcome. */
  resolveRoute: (
    serverId: string,
    auth: McpAuthResolved | null,
    signal?: AbortSignal,
  ) => Promise<McpRouteResult>;
  /**
   * Servers that already produced an auth notice in this send, with the error they gave.
   * Belongs to the send, so it is created where the send builds this context.
   */
  authNotices?: Map<string, string>;
}

/** Outcome of resolving a route on this device. */
export type McpRouteResult =
  | { ok: true; routing: McpRouting; resolvedEndpoint: string }
  | { ok: false; error: string; auth?: McpAuthSignal; scope?: string };

const DECLINED: ToolResult = { ok: false, output: '', error: 'Tool call declined by the user.' };

function resolveAuth(server: McpActiveServer, key: string | null): McpAuthResolved | null {
  if (!server.auth || !key) return null;
  if (server.auth.scheme === 'oauth') return null;
  if (server.auth.scheme === 'bearer') return { header: 'Authorization', value: `Bearer ${key}` };
  return { header: server.auth.headerName, value: key };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** True when `endpoint` is, canonically, the server's own URL: the only place a token goes. */
function isServerUrl(server: McpActiveServer, endpoint: string): boolean {
  try {
    return canonicalResource(endpoint) === canonicalResource(server.url);
  } catch {
    return false;
  }
}

/**
 * Removes credentials from an error before the model or the UI sees it: any
 * `Bearer <value>` and every exact secret this call held.
 */
function scrub(message: string, secrets: ReadonlyArray<string | null>): string {
  let out = message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  }
  return out;
}

const fail = (error: string): ToolResult => ({ ok: false, output: '', error });

/** Build the active MCP tools for this send. Mirrors `contributeKnowledgeTools`. */
export function contributeMcpTools(ctx: McpToolContext): Tool[] {
  const visible = ctx.servers.map((s) => ({
    server: s,
    visibleTools: s.tools.filter((t) => !s.hiddenTools.includes(t.name)),
  }));
  const { tools: named } = buildMcpToolNames(
    visible.map((v) => ({ id: v.server.id, prefix: v.server.prefix, tools: v.visibleTools })),
  );
  const notices = ctx.authNotices ?? new Map<string, string>();

  // Several tools share a server and a send may call them repeatedly: one probe is enough.
  const routes = new Map<string, Promise<McpRouteResult>>();
  const routeFor = (
    server: McpActiveServer,
    auth: McpAuthResolved | null,
    signal?: AbortSignal,
  ) => {
    if (server.routing && server.resolvedEndpoint) {
      const known: McpRouteResult = {
        ok: true,
        routing: server.routing,
        resolvedEndpoint: server.resolvedEndpoint,
      };
      return Promise.resolve(known);
    }
    let route = routes.get(server.id);
    if (!route) {
      // A failure stays retryable within the turn: the model may well try again.
      route = ctx.resolveRoute(server.id, auth, signal).then(
        (r) => {
          if (!r.ok) routes.delete(server.id);
          return r;
        },
        (e: unknown) => {
          routes.delete(server.id);
          throw e;
        },
      );
      routes.set(server.id, route);
    }
    return route;
  };

  /** A failing result carrying the chat notice; later calls in this send repeat it bare. */
  const notice = (
    server: McpActiveServer,
    variant: McpAuthNotice['variant'],
    scope?: string,
  ): ToolResult => {
    // A parallel call may have produced the notice meanwhile: one per server per send.
    const earlier = notices.get(server.id);
    if (earlier !== undefined) return fail(earlier);
    const why =
      variant === 'dead'
        ? 'its sign-in has ended and the user needs to sign in again'
        : variant === 'held'
          ? 'its sign-in is paused on this device, and the user can sign in again'
          : variant === 'scope'
            ? 'it needs more access than the user granted, which the user can grant'
            : "access to it can't be renewed right now";
    const error = `${server.name} is unavailable: ${why}. Tell the user, and do not retry this tool in this turn.`;
    notices.set(server.id, error);
    const mcpAuth: McpAuthNotice = {
      serverId: server.id,
      serverName: server.name,
      variant,
      ...(scope ? { scope } : {}),
    };
    return { ok: false, output: '', error, meta: { mcpAuth } };
  };

  const tokenFailure = (
    server: McpActiveServer,
    result: Extract<McpTokenResult, { ok: false }>,
  ): ToolResult => {
    switch (result.reason) {
      case 'locked':
        return fail(
          `${server.name} is unavailable while Chatsundere is locked. Ask the user to unlock it, then try again.`,
        );
      case 'not-oauth':
        return fail(`${server.name} is unavailable: it is not set up to sign in.`);
      case 'mismatch':
        return fail(
          `${server.name} is unavailable: its sign-in belongs to a different address. Tell the user, and do not retry this tool in this turn.`,
        );
      case 'dead':
        return notice(server, 'dead');
      case 'held':
        return notice(server, 'held');
      default:
        return notice(server, 'waiting');
    }
  };

  const result: Tool[] = [];
  for (const n of named) {
    const entry = visible.find((v) => v.server.id === n.serverId);
    if (!entry) continue;
    const server = entry.server;
    const def = entry.visibleTools.find((t) => t.name === n.originalName);
    if (!def) continue;
    result.push({
      name: n.wireName,
      description: def.description,
      parameters: def.inputSchema,
      systemPromptInstruction: null,
      async execute(
        args: Record<string, unknown>,
        signal?: AbortSignal,
        onProgress?: (p: ToolProgress) => void,
      ): Promise<ToolResult> {
        const noticed = notices.get(server.id);
        if (noticed !== undefined) return fail(noticed);

        const host = hostOf(server.url);
        // Consent comes before any key or token is opened, and nothing is stored on a no.
        if (!server.hasConsent && server.autoRun) {
          if (!(await firstUseDecision(server, host))) return DECLINED;
        }
        if (!server.autoRun) {
          const ok = await ctx.requestApproval({
            serverId: server.id,
            serverName: server.name,
            toolName: n.originalName,
            args,
            host,
            firstUse: !server.hasConsent,
          });
          if (!ok) return DECLINED;
          if (!server.hasConsent) await rememberConsent(server);
        }

        const secrets: Array<string | null> = [];
        try {
          const oauth = server.auth?.scheme === 'oauth';
          let auth: McpAuthResolved | null;
          let token: string | null = null;
          const onWaiting = () => onProgress?.({ charCount: 0, phase: 'renewing' });
          if (oauth) {
            const t = await ctx.getOAuthToken(server.id, {
              ...(signal ? { signal } : {}),
              onWaiting,
            });
            if (!t.ok) return tokenFailure(server, t);
            token = t.accessToken;
            secrets.push(token);
            auth = { header: 'Authorization', value: `Bearer ${token}` };
          } else {
            const key = await ctx.getServerKey(server.id);
            secrets.push(key);
            auth = resolveAuth(server, key);
          }

          // A 401 cannot have run the tool, so one renewal and one more attempt are safe.
          let renewed = false;
          const renew = async (): Promise<ToolResult | null> => {
            if (renewed || token === null) return notice(server, 'dead');
            renewed = true;
            const t = await ctx.getOAuthToken(server.id, {
              rejectedToken: token,
              ...(signal ? { signal } : {}),
              onWaiting,
            });
            if (!t.ok) return tokenFailure(server, t);
            token = t.accessToken;
            secrets.push(token);
            auth = { header: 'Authorization', value: `Bearer ${token}` };
            return null;
          };

          for (;;) {
            const route = await routeFor(server, auth, signal);
            if (!route.ok) {
              if (oauth && route.auth === 'required') {
                const stop = await renew();
                if (stop) return stop;
                continue;
              }
              if (oauth && route.auth === 'insufficient-scope') {
                return notice(server, 'scope', route.scope);
              }
              return fail(scrub(`Could not connect to ${server.name}: ${route.error}`, secrets));
            }
            // The chokepoint at the point of sending: a token goes to the server's own URL only.
            if (oauth && !isServerUrl(server, route.resolvedEndpoint)) {
              return fail(
                `${server.name} is unavailable: its address no longer matches its sign-in. Tell the user, and do not retry this tool in this turn.`,
              );
            }
            const endpoint: McpEndpoint = {
              url: route.resolvedEndpoint,
              routing: route.routing,
              auth,
            };
            const r: McpCallResult = await mcpToolsCall(
              endpoint,
              n.originalName,
              args,
              MCP_CALL_TIMEOUT_MS,
              signal,
            );
            if (oauth && r.auth === 'required') {
              const stop = await renew();
              if (stop) return stop;
              continue;
            }
            if (oauth && r.auth === 'insufficient-scope') return notice(server, 'scope', r.scope);
            if (r.error) return fail(scrub(r.error, secrets));
            return { ok: true, output: r.stdout, error: null };
          }
        } catch (e) {
          return fail(scrub(e instanceof Error ? e.message : 'MCP tool failed.', secrets));
        }
      },
    });
  }

  // Parallel calls to one server share the question in flight; once answered it is
  // dropped, so a "Not now" answers only the calls that were waiting on it.
  const firstUse = new Map<string, Promise<boolean>>();
  function firstUseDecision(server: McpActiveServer, host: string): Promise<boolean> {
    let decision = firstUse.get(server.id);
    if (!decision) {
      decision = (async () => {
        try {
          const ok = await ctx.requestFirstUse({
            serverId: server.id,
            serverName: server.name,
            host,
          });
          if (ok) await rememberConsent(server);
          return ok;
        } catch {
          return false;
        }
      })();
      const settled = decision;
      firstUse.set(server.id, settled);
      void settled.finally(() => {
        if (firstUse.get(server.id) === settled) firstUse.delete(server.id);
      });
    }
    return decision;
  }

  async function rememberConsent(server: McpActiveServer): Promise<void> {
    server.hasConsent = true;
    try {
      await ctx.recordConsent(server.id, server.url);
    } catch {
      // The user did agree; failing to store it only means asking again next send.
    }
  }

  return result;
}
