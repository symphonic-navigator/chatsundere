// SPDX-License-Identifier: AGPL-3.0-only
import type { DoorbellPoke, DoorbellTicketResponse } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { apiFetch, joinUrl, refreshAccessToken } from '../lib/fetch.js';
import { scheduleClass1Sync } from './triggers.js';
import { getSyncState } from './watermark.js';

/**
 * The doorbell consumer (spec §9). A WSS socket that pokes the engine awake when
 * another device pushes — an ACCELERANT, never a dependency: every correctness
 * property holds with the socket permanently dead (the timer + foreground +
 * piggyback still converge). It NEVER pulls or recovers itself; a poke only
 * schedules a cycle through the shared debounced scheduler.
 *
 * Security (Larissa):
 *  - M-4: an epoch-mismatch poke schedules a VERIFICATION cycle, never recovery
 *    directly — a poke is unauthenticated content.
 *  - L-5: close-code `4401` triggers AT MOST one token refresh per backoff cycle
 *    (reset only on a successful open), then the socket degrades silently to the
 *    timer.
 *  - I-4: the single-use ticket and the WSS URL NEVER enter diagnostics, logs,
 *    or the status line — `doorbellDiagnostics()` excludes both by construction,
 *    and nothing here logs.
 */

/** Reconnect backoff base; doubles per attempt, capped at 60 s (§9). */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

// ===== Injectable socket (production default: the DOM WebSocket) =====

/** The minimal socket surface the consumer drives; tests inject a mock. */
export interface DoorbellSocket {
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (event: { code: number }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
}
export type DoorbellSocketFactory = (url: string) => DoorbellSocket;

const defaultFactory: DoorbellSocketFactory = (url) =>
  // The DOM WebSocket satisfies DoorbellSocket structurally for the events we
  // use; the double cast bridges its heavily-overloaded addEventListener type.
  new WebSocket(url) as unknown as DoorbellSocket;

let factory: DoorbellSocketFactory = defaultFactory;
let ticketFetcher: (() => Promise<string>) | null = null;
let refreshFn: ((baseUrl: string) => Promise<boolean>) | null = null;
let scheduler: () => void = scheduleClass1Sync;

// ===== Connection state =====

let socket: DoorbellSocket | null = null;
let connecting = false;
let backoffAttempt = 0;
/** L-5: one refresh per backoff cycle; reset only on a successful open. */
let refreshedThisCycle = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastCloseCode: number | null = null;

let unsubs: (() => void)[] = [];
let visibilityHandler: (() => void) | null = null;
let started = false;

// ===== Lifecycle gating (spec §9) =====

/** Connect ONLY while linked + unlocked + document visible + not offline (§9). */
function gateOpen(): boolean {
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return false;
  if (useSessionStore.getState().mk === null) return false;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  if (useConnectivityStore.getState().state.kind === 'local_offline') return false;
  if (!useDiscoveryStore.getState().config?.syncUrl) return false;
  return true;
}

/** Reconcile the socket to the lifecycle gate: connect when open, drop when shut. */
function evaluate(): void {
  if (!started) return;
  if (gateOpen()) {
    if (socket === null && !connecting && reconnectTimer === null) void connect();
  } else {
    disconnect();
  }
}

// ===== Connect / disconnect =====

async function connect(): Promise<void> {
  if (connecting || socket !== null) return;
  const syncUrl = useDiscoveryStore.getState().config?.syncUrl;
  if (!syncUrl) return;
  connecting = true;

  let ticket: string;
  try {
    ticket = ticketFetcher ? await ticketFetcher() : await fetchTicket(syncUrl);
  } catch {
    connecting = false;
    scheduleReconnect(); // ticket fetch failed — back off, retry with a fresh ticket
    return;
  }

  // The await may have crossed a lifecycle change — re-check before opening.
  if (!gateOpen()) {
    connecting = false;
    return;
  }

  const ws = factory(doorbellWssUrl(syncUrl, ticket));
  socket = ws;
  connecting = false;

  ws.addEventListener('open', () => {
    if (ws !== socket) return;
    backoffAttempt = 0;
    refreshedThisCycle = false;
  });
  ws.addEventListener('message', (event) => {
    if (ws !== socket) return;
    void handleMessage(event.data);
  });
  ws.addEventListener('close', (event) => {
    if (ws !== socket) return;
    socket = null;
    lastCloseCode = event.code;
    void handleClose(event.code);
  });
  ws.addEventListener('error', () => {
    // Errors surface as a following close event; nothing logged (I-4).
  });
}

/** Tear the socket down and reset the backoff (a clean lifecycle-driven stop). */
function disconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const ws = socket;
  socket = null;
  connecting = false;
  backoffAttempt = 0;
  refreshedThisCycle = false;
  if (ws !== null) {
    try {
      ws.close();
    } catch {
      // Already closing/closed — nothing to do.
    }
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  backoffAttempt += 1;
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (backoffAttempt - 1));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (gateOpen()) void connect();
  }, delay);
}

// ===== Poke handling (spec §9) =====

async function handleMessage(data: unknown): Promise<void> {
  const poke = parsePoke(data);
  if (poke === null) return;
  const state = await getSyncState();

  // Epoch mismatch → a verification cycle (NEVER recovery directly, M-4). The
  // authenticated worker path is the only thing that may run recovery.
  if (state.epoch !== null && state.epoch !== poke.epoch) {
    scheduler();
    return;
  }
  // A rev ahead of our watermark → schedule a (debounced) cycle. The pusher
  // hears its own bell; echo-tolerant pulls make that harmless (§9).
  if (poke.rev > state.watermarkRev) scheduler();
}

/** Parse a poke frame defensively — a malformed frame is ignored, never thrown. */
function parsePoke(data: unknown): DoorbellPoke | null {
  let obj: unknown = data;
  if (typeof data === 'string') {
    try {
      obj = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const rec = obj as { rev?: unknown; epoch?: unknown };
  if (typeof rec.rev !== 'number' || typeof rec.epoch !== 'string') return null;
  return { rev: rec.rev, epoch: rec.epoch };
}

// ===== Close handling: the 4401 refresh cap (L-5) =====

async function handleClose(code: number): Promise<void> {
  if (!started) return;

  if (code === 4401 && !refreshedThisCycle) {
    refreshedThisCycle = true; // at most one refresh per backoff cycle (L-5)
    const syncUrl = useDiscoveryStore.getState().config?.syncUrl;
    if (syncUrl) {
      const refresh = refreshFn ?? refreshAccessToken;
      await refresh(syncUrl);
    }
  }

  // A lifecycle change may have shut the gate while the refresh awaited.
  if (!gateOpen()) return;
  scheduleReconnect();
}

// ===== Ticket + URL derivation (I-4: neither is ever logged) =====

async function fetchTicket(syncUrl: string): Promise<string> {
  const res = await apiFetch<DoorbellTicketResponse>({
    baseUrl: syncUrl,
    path: '/api/v1/sync/doorbell-ticket',
    json: {},
    authMode: 'bearer',
  });
  return res.ticket;
}

/** Derive the `wss://…/doorbell?ticket=…` URL from `syncUrl` (path-prefix safe). */
function doorbellWssUrl(syncUrl: string, ticket: string): string {
  const url = new URL(joinUrl(syncUrl, '/api/v1/sync/doorbell'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

// ===== Boot wiring =====

/**
 * Wire the doorbell into boot (called from `server-foundation.ts`). Subscribes
 * to the lifecycle stores + visibility and reconciles the socket on every
 * change. Idempotent.
 */
export function initDoorbell(): void {
  if (started) return;
  started = true;
  unsubs.push(useAccountLinkStore.subscribe(() => evaluate()));
  unsubs.push(useConnectivityStore.subscribe(() => evaluate()));
  unsubs.push(useSessionStore.subscribe(() => evaluate()));
  unsubs.push(useDiscoveryStore.subscribe(() => evaluate()));
  if (typeof document !== 'undefined') {
    visibilityHandler = () => evaluate();
    document.addEventListener('visibilitychange', visibilityHandler);
  }
  evaluate();
}

/** Remove every subscription and drop the socket (tests, and a clean re-init). */
export function teardownDoorbell(): void {
  started = false;
  for (const unsub of unsubs) unsub();
  unsubs = [];
  if (visibilityHandler !== null && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  visibilityHandler = null;
  disconnect();
}

/**
 * Safe diagnostics for the status-line detail (Task 13). By construction this
 * EXCLUDES the ticket and the WSS URL (Larissa I-4) — only opaque connection
 * health is exposed.
 */
export function doorbellDiagnostics(): {
  connected: boolean;
  backoffAttempt: number;
  lastCloseCode: number | null;
} {
  return { connected: socket !== null, backoffAttempt, lastCloseCode };
}

// ===== Test seams =====

/** Test seam: inject a mock WebSocket factory (defaults to the DOM WebSocket). */
export function _setWebSocketFactory(fn: DoorbellSocketFactory | null): void {
  factory = fn ?? defaultFactory;
}
/** Test seam: inject the ticket fetcher (defaults to the authenticated POST). */
export function _setTicketFetcher(fn: (() => Promise<string>) | null): void {
  ticketFetcher = fn;
}
/** Test seam: inject the token-refresh function (defaults to `refreshAccessToken`). */
export function _setDoorbellRefresh(fn: ((baseUrl: string) => Promise<boolean>) | null): void {
  refreshFn = fn;
}
/** Test seam: inject the poke scheduler (defaults to `scheduleClass1Sync`). */
export function _setDoorbellScheduler(fn: (() => void) | null): void {
  scheduler = fn ?? scheduleClass1Sync;
}
/** Test seam: tear everything down and restore every override to its default. */
export function _resetDoorbellForTests(): void {
  teardownDoorbell();
  factory = defaultFactory;
  ticketFetcher = null;
  refreshFn = null;
  scheduler = scheduleClass1Sync;
  backoffAttempt = 0;
  refreshedThisCycle = false;
  lastCloseCode = null;
}
