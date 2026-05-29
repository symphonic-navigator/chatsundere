// SPDX-License-Identifier: LGPL-3.0-only
// Runs inside a Bun Worker. Imports an adapter module by path (first message),
// then answers buildRequest / parseChunk calls. No network, no storage access
// is granted to or used by this entry — the adapter is a pure transformation.

// Bun exposes `self` as a global in worker scope but does not declare it in the
// module-scope types. We declare it locally to satisfy strict TypeScript without
// loosening the package tsconfig.
declare const self: Worker;

let adapter: {
  buildRequest: (req: unknown) => unknown;
  parseChunk: (raw: unknown, state: unknown) => unknown;
  profile: unknown;
} | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as {
    id: number;
    cmd: string;
    modulePath?: string;
    arg1?: unknown;
    arg2?: unknown;
  };
  try {
    if (msg.cmd === 'init') {
      const mod = await import(msg.modulePath as string);
      adapter = mod.adapter ?? mod.default;
      self.postMessage({ id: msg.id, ok: true, result: adapter?.profile });
      return;
    }
    if (!adapter) throw new Error('adapter not initialised');
    if (msg.cmd === 'buildRequest') {
      self.postMessage({ id: msg.id, ok: true, result: adapter.buildRequest(msg.arg1) });
      return;
    }
    if (msg.cmd === 'parseChunk') {
      self.postMessage({ id: msg.id, ok: true, result: adapter.parseChunk(msg.arg1, msg.arg2) });
      return;
    }
    throw new Error(`unknown cmd ${msg.cmd}`);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: (err as Error).message });
  }
};
