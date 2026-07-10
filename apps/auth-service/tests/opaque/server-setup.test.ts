// SPDX-License-Identifier: AGPL-3.0-only
//
// Finding #10b: getServerSetup() must hard-fail outside tests when
// OPAQUE_SERVER_SETUP is unset, rather than silently falling back to a
// per-process ephemeral setup that invalidates every account on restart.

import { afterEach, describe, expect, test } from 'bun:test';

// tests/setup.ts leaves OPAQUE_SERVER_SETUP and ALLOW_EPHEMERAL_OPAQUE_SETUP
// unset and defaults NODE_ENV to 'test'. Each case overrides and restores.
const savedNodeEnv = process.env.NODE_ENV;
const savedSetup = process.env.OPAQUE_SERVER_SETUP;
const savedEscapeHatch = process.env.ALLOW_EPHEMERAL_OPAQUE_SETUP;

afterEach(() => {
  if (savedNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedSetup === undefined) Reflect.deleteProperty(process.env, 'OPAQUE_SERVER_SETUP');
  else process.env.OPAQUE_SERVER_SETUP = savedSetup;
  if (savedEscapeHatch === undefined)
    Reflect.deleteProperty(process.env, 'ALLOW_EPHEMERAL_OPAQUE_SETUP');
  else process.env.ALLOW_EPHEMERAL_OPAQUE_SETUP = savedEscapeHatch;
});

// getServerSetup() caches its result in a module-level variable, so each case
// needs a fresh module instance. A query-string-suffixed dynamic import gives
// Bun a distinct module identity (and therefore a fresh cache) without
// exposing a test-only reset hook from production code.
let importCounter = 0;
async function freshGetServerSetup() {
  importCounter += 1;
  const mod = await import(`../../src/opaque/server.js?test-case=${importCounter}`);
  // The ephemeral fallback path calls into the OPAQUE WASM module directly,
  // which needs to finish loading first — a fresh module instance does not
  // inherit the readiness already awaited elsewhere in the test run.
  await (mod.ensureOpaqueReady as () => Promise<void>)();
  return mod.getServerSetup as () => string;
}

describe('getServerSetup', () => {
  test('throws when OPAQUE_SERVER_SETUP is unset outside tests and the escape hatch is unset', async () => {
    process.env.NODE_ENV = 'production';
    Reflect.deleteProperty(process.env, 'OPAQUE_SERVER_SETUP');
    Reflect.deleteProperty(process.env, 'ALLOW_EPHEMERAL_OPAQUE_SETUP');

    const getServerSetup = await freshGetServerSetup();
    expect(() => getServerSetup()).toThrow(/OPAQUE_SERVER_SETUP/);
  });

  test('returns an ephemeral setup without throwing when NODE_ENV is test', async () => {
    process.env.NODE_ENV = 'test';
    Reflect.deleteProperty(process.env, 'OPAQUE_SERVER_SETUP');
    Reflect.deleteProperty(process.env, 'ALLOW_EPHEMERAL_OPAQUE_SETUP');

    const getServerSetup = await freshGetServerSetup();
    expect(() => getServerSetup()).not.toThrow();
    expect(typeof getServerSetup()).toBe('string');
  });

  test('returns an ephemeral setup and warns when the escape hatch is set outside tests', async () => {
    process.env.NODE_ENV = 'production';
    Reflect.deleteProperty(process.env, 'OPAQUE_SERVER_SETUP');
    process.env.ALLOW_EPHEMERAL_OPAQUE_SETUP = '1';

    const warnCalls: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      const getServerSetup = await freshGetServerSetup();
      expect(() => getServerSetup()).not.toThrow();
      expect(typeof getServerSetup()).toBe('string');
      expect(warnCalls.length).toBeGreaterThan(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('returns the configured setup verbatim when OPAQUE_SERVER_SETUP is set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPAQUE_SERVER_SETUP = 'a'.repeat(40);
    Reflect.deleteProperty(process.env, 'ALLOW_EPHEMERAL_OPAQUE_SETUP');

    const getServerSetup = await freshGetServerSetup();
    expect(getServerSetup()).toBe('a'.repeat(40));
  });
});
