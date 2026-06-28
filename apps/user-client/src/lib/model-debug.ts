// SPDX-License-Identifier: AGPL-3.0-only
import { offeringToTarget, streamCompletion } from '@chatsundere/llm-unified';
import type {
  Offering,
  ProviderConfig,
  ProviderDefinition,
  StreamChunk,
  StreamDiagnosticsSink,
} from '@chatsundere/llm-unified';

/** Best-effort snapshot of the user's runtime, captured at report-build time. */
export interface EnvSnapshot {
  userAgent: string;
  platform: string;
  crossOriginIsolated: boolean;
  online: boolean;
  timeZone: string;
}

/** A complete model-test or chat-failure diagnostic, ready to render or serialise. */
export interface DiagnosticReport {
  kind: 'test' | 'chat-failure';
  provider: {
    displayName: string;
    routing: 'direct' | 'cors-proxy';
    targetHost: string;
    proxyHost?: string;
  };
  model: string;
  whenIso: string;
  env: EnvSnapshot;
  request?: { method: string; url: string };
  response?: { status: number; statusText: string; headers: Record<string, string> };
  timeline: { atMs: number; text: string }[];
  chunkCount: number;
  replyText: string;
  outcome: 'success' | 'failed';
  outcomeDetail: string;
  error?: string;
  totalMs: number;
}

type BuildMeta = Omit<
  DiagnosticReport,
  'request' | 'response' | 'timeline' | 'chunkCount' | 'replyText' | 'error' | 'totalMs'
>;

/** Reads navigator/Intl for the [Environment] block. Safe in SSR/jsdom. */
export function buildEnvironmentSnapshot(): EnvSnapshot {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  let timeZone = 'unknown';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  } catch {
    // Intl may be unavailable in exotic runtimes; leave 'unknown'.
  }
  const coi = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
  const ua = nav?.userAgent ?? 'unknown';
  return {
    userAgent: ua,
    platform: `${nav?.platform ?? 'unknown'} · crossOriginIsolated: ${coi}`,
    crossOriginIsolated: coi,
    online: nav?.onLine ?? true,
    timeZone,
  };
}

/**
 * Accumulates a transport timeline from sink events + stream chunks. `now`
 * defaults to a monotonic clock; tests inject a deterministic one. On a
 * tool-loop the caller fires `onRequest` again per round — the timeline keeps
 * all lines, and `build()` reports the whole accumulation (the last request
 * segment is the one that was active when a failure landed).
 */
export function createDiagnosticsCollector(now: () => number = () => performance.now()) {
  const start = now();
  const timeline: { atMs: number; text: string }[] = [];
  let request: DiagnosticReport['request'];
  let response: DiagnosticReport['response'];
  let chunkCount = 0;
  let replyText = '';
  let firstTokenSeen = false;
  let lastChunkAt = start;

  const rel = (): number => Math.round(now() - start);

  const sink: StreamDiagnosticsSink = {
    onRequest(info) {
      request = { method: info.method, url: info.url };
      firstTokenSeen = false;
      lastChunkAt = now();
      timeline.push({ atMs: rel(), text: `request sent → ${info.method} ${info.url}` });
    },
    onResponse(info) {
      response = info;
      const ct = info.headers['content-type'];
      const ce = info.headers['content-encoding'];
      timeline.push({
        atMs: rel(),
        text: `response headers · HTTP ${info.status} ${info.statusText}${ct ? ` · content-type: ${ct}` : ''}${ce ? ` · content-encoding: ${ce} ⚠` : ''}`,
      });
    },
  };

  return {
    sink,
    markChunk(chunk: StreamChunk): void {
      const t = now();
      if (chunk.type === 'token') {
        chunkCount += 1;
        replyText += chunk.text;
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          timeline.push({
            atMs: rel(),
            text: `first token / chunk 1 (${JSON.stringify(chunk.text)})`,
          });
        } else {
          timeline.push({
            atMs: rel(),
            text: `chunk ${chunkCount} (gap ${Math.round(t - lastChunkAt)}ms)`,
          });
        }
        lastChunkAt = t;
      } else if (chunk.type === 'reasoning') {
        lastChunkAt = t;
      } else if (chunk.type === 'finish') {
        timeline.push({ atMs: rel(), text: `finish (${chunk.reason})` });
      } else if (chunk.type === 'error') {
        timeline.push({ atMs: rel(), text: `✗ stream error chunk: ${chunk.message}` });
      } else if (chunk.type === 'tool-call') {
        // Log only the tool name — never argumentsJson, which can carry private content.
        timeline.push({ atMs: rel(), text: `tool call: ${chunk.name}` });
        lastChunkAt = t;
      } else if (chunk.type === 'usage') {
        // Timing-only; never print token counts, and keep the timeline free of noise.
        lastChunkAt = t;
      }
    },
    markStall(sinceMs: number): void {
      timeline.push({ atMs: rel(), text: `⚠ STALL — no chunk for ${sinceMs}ms` });
    },
    markError(message: string): void {
      timeline.push({ atMs: rel(), text: `✗ ERROR ${message} (chunks so far: ${chunkCount})` });
    },
    build(meta: BuildMeta): DiagnosticReport {
      return {
        ...meta,
        request,
        response,
        timeline,
        chunkCount,
        replyText,
        error:
          meta.outcome === 'failed'
            ? (timeline.find((t) => t.text.startsWith('✗ ERROR'))?.text ?? meta.outcomeDetail)
            : undefined,
        totalMs: rel(),
      };
    },
  };
}

const REPLY_LABEL_TEST = 'Reply received';
const REPLY_LABEL_CHAT = 'Partial reply your device received — included so we can spot corruption';

/** Serialise a report to the plain text used by the rendered block and copy. */
export function formatReport(r: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(
    r.kind === 'chat-failure'
      ? '=== Chatsundere Chat-Stream Failure ==='
      : '=== Chatsundere Model Test ===',
  );
  lines.push(
    `Provider:  ${r.provider.displayName} (${r.provider.routing}${r.provider.proxyHost ? ` → ${r.provider.proxyHost}` : ''})`,
  );
  lines.push(`Model:     ${r.model}`);
  lines.push(`When:      ${r.whenIso}`);
  lines.push('');
  lines.push('[Environment]');
  lines.push(`UA: ${r.env.userAgent}`);
  lines.push(`${r.env.platform} · online: ${r.env.online} · TZ: ${r.env.timeZone}`);
  lines.push('');
  lines.push('[Transport]');
  lines.push(`Route: ${r.provider.routing}   Target host: ${r.provider.targetHost}`);
  lines.push('');
  if (r.response) {
    lines.push('[Response]');
    const ce = r.response.headers['content-encoding'];
    const ct = r.response.headers['content-type'];
    lines.push(
      `HTTP ${r.response.status} ${r.response.statusText}${ct ? ` · content-type: ${ct}` : ''}${ce ? ` · content-encoding: ${ce} ⚠` : ''}`,
    );
    lines.push('');
  }
  lines.push('[Timeline]');
  for (const t of r.timeline) lines.push(`+${t.atMs}ms`.padEnd(10) + t.text);
  lines.push('');
  if (r.replyText.length > 0) {
    lines.push(`[${r.kind === 'chat-failure' ? REPLY_LABEL_CHAT : REPLY_LABEL_TEST}]`);
    lines.push(r.replyText);
    lines.push('');
  }
  lines.push(`[Outcome] ${r.outcome === 'success' ? 'OK' : 'FAILED'} — ${r.outcomeDetail}`);
  return lines.join('\n');
}

const TEST_PROMPT = 'Count slowly from 1 to 10. Put each number on its own line.';
const STALL_MS = 5000;

export interface RunStreamingTestArgs {
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  /** Host shown in the report for cors-proxy routing (no scheme). */
  proxyHost?: string;
  signal: AbortSignal;
  /** Test seam: inject a fake stream. Defaults to the real streamCompletion. */
  _streamFn?: typeof streamCompletion;
  /** Test seam: deterministic clock. */
  _now?: () => number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Runs the real streaming transport against a fixed multi-token prompt and
 * returns a DiagnosticReport. A 5 s stall watchdog appends a STALL line without
 * killing the connection; the overall timeout + Stop is the caller's
 * AbortController (passed via `signal`).
 */
export async function runStreamingTest(args: RunStreamingTestArgs): Promise<DiagnosticReport> {
  const streamFn = args._streamFn ?? streamCompletion;
  const collector = createDiagnosticsCollector(args._now);
  const env = buildEnvironmentSnapshot();
  const routing = args.providerConfig.routing.kind === 'cors-proxy' ? 'cors-proxy' : 'direct';
  let outcome: 'success' | 'failed' = 'failed';
  let outcomeDetail = 'unknown';
  let stalled = false;

  try {
    const iterable = streamFn({
      provider: args.provider,
      providerConfig: args.providerConfig,
      apiKey: args.apiKey,
      corsProxyUrl: args.corsProxyUrl,
      corsProxyKey: args.corsProxyKey,
      target: offeringToTarget(args.offering),
      messages: [{ role: 'user', content: TEST_PROMPT }],
      bodyExtras: {},
      signal: args.signal,
      onDiagnostics: collector.sink,
    });
    const iterator = iterable[Symbol.asyncIterator]();
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stallP = new Promise<'stall'>((resolve) => {
          timer = setTimeout(() => resolve('stall'), STALL_MS);
        });
        const nextP = iterator.next();
        const winner = await Promise.race([nextP, stallP]);
        if (winner === 'stall') {
          stalled = true;
          collector.markStall(STALL_MS);
          const r = await nextP; // keep awaiting the real chunk
          if (r.done) break;
          collector.markChunk(r.value);
          continue;
        }
        const r = winner as IteratorResult<StreamChunk>;
        if (r.done) break;
        collector.markChunk(r.value);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    outcome = 'success';
    outcomeDetail = 'stream completed';
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    collector.markError(msg);
    outcome = 'failed';
    outcomeDetail = stalled ? 'stream stalled then errored' : 'errored before completing';
  }

  return collector.build({
    kind: 'test',
    provider: {
      displayName: args.provider.displayName,
      routing,
      targetHost: hostOf(args.provider.baseUrl),
      ...(routing === 'cors-proxy' && args.proxyHost ? { proxyHost: args.proxyHost } : {}),
    },
    model: args.offering.upstreamSlug,
    whenIso: new Date().toISOString(),
    env,
    outcome,
    outcomeDetail,
  });
}
