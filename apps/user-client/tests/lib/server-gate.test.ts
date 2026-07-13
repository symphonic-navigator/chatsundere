// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { copy } from '../../src/lib/copy.js';
import { type GateInputs, deriveServerGate } from '../../src/lib/server-gate.js';

function inputs(overrides: Partial<GateInputs>): GateInputs {
  return {
    linkStatus: 'linked',
    connectivity: 'linked_online',
    discoveryStatus: 'ok',
    config: { proxyUrl: 'https://proxy.example.org', features: ['proxy', 'sync'] },
    feature: 'proxy',
    hasInviteUrl: false,
    ...overrides,
  };
}

describe('deriveServerGate', () => {
  it('enables when linked, online, and the feature is offered', () => {
    expect(deriveServerGate(inputs({}))).toEqual({
      enabled: true,
      reason: null,
      tooltip: null,
    });
  });

  it('boot-pending link state routes to the checking bucket, never invitation copy', () => {
    const gate = deriveServerGate(inputs({ linkStatus: 'unknown' }));
    expect(gate.reason).toBe('unknown');
    expect(gate.tooltip).toBe(copy.serverGate.checking);
  });

  it('local-only picks the invite variant only when an invite URL is configured', () => {
    const without = deriveServerGate(inputs({ linkStatus: 'local-only' }));
    expect(without.reason).toBe('local-only');
    expect(without.tooltip).toBe(copy.serverGate.localOnly);

    const withInvite = deriveServerGate(inputs({ linkStatus: 'local-only', hasInviteUrl: true }));
    expect(withInvite.tooltip).toBe(copy.serverGate.localOnlyWithInvite);
  });

  it('auth-failed takes priority over offline and never claims a waiting cure', () => {
    const gate = deriveServerGate(inputs({ connectivity: 'server_auth_failed' }));
    expect(gate.reason).toBe('auth-action');
    expect(gate.tooltip).toBe(copy.serverGate.authAction);
  });

  it('server_unreachable and local_offline both read as offline', () => {
    for (const kind of ['server_unreachable', 'local_offline'] as const) {
      const gate = deriveServerGate(inputs({ connectivity: kind }));
      expect(gate.reason).toBe('offline');
      expect(gate.tooltip).toBe(copy.serverGate.offline);
    }
  });

  it('server_rate_limited reads as offline (paused) but with the honest busy copy', () => {
    const gate = deriveServerGate(inputs({ connectivity: 'server_rate_limited' }));
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe('offline');
    expect(gate.tooltip).toBe(copy.serverGate.serverBusy);
    // Distinct from the plain-offline copy — the user is told they are throttled.
    expect(gate.tooltip).not.toBe(copy.serverGate.offline);
  });

  it('discovery invalid is server-error, distinct from offline', () => {
    const gate = deriveServerGate(
      inputs({ discoveryStatus: 'invalid', connectivity: 'linked_online' }),
    );
    expect(gate.reason).toBe('server-error');
    expect(gate.tooltip).toBe(copy.serverGate.serverOdd);
  });

  it('no config yet this session reads as checking', () => {
    const gate = deriveServerGate(inputs({ discoveryStatus: 'probing', config: null }));
    expect(gate.reason).toBe('unknown');
  });

  it('a re-probe with a prior config keeps gating on that config', () => {
    const gate = deriveServerGate(inputs({ discoveryStatus: 'probing' }));
    expect(gate.enabled).toBe(true);
  });

  it('a feature the server does not offer is feature-missing', () => {
    const gate = deriveServerGate(inputs({ feature: 'blobs' }));
    expect(gate.reason).toBe('feature-missing');
    expect(gate.tooltip).toBe(copy.serverGate.featureMissing);
  });

  it('disabled gates always carry a tooltip; enabled gates never do', () => {
    const disabled = deriveServerGate(inputs({ linkStatus: 'local-only' }));
    expect(disabled.tooltip).not.toBeNull();
    const enabled = deriveServerGate(inputs({}));
    expect(enabled.tooltip).toBeNull();
  });
});
