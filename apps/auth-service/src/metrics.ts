// SPDX-License-Identifier: AGPL-3.0-only

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const ALLOWED_LABEL_NAMES = new Set([
  'method_type',
  'result',
  'role',
  'kind',
  'action',
  'route',
  'method',
  'status_class',
  // Step-up tier (1|2|3|4) per ADR 0027 — classifies the destructiveness of
  // the endpoint being gated. Not PII; high-cardinality bounded to 4 values.
  'tier',
  // Wrapping-invariant violation reason (no_opaque_method |
  // multiple_opaque_methods | null_wrapping_columns) — bounded enum, not PII.
  'reason',
]);

function assertLabelsAllowed(labelNames: string[], metricName: string): void {
  for (const name of labelNames) {
    if (!ALLOWED_LABEL_NAMES.has(name)) {
      throw new Error(
        `metrics: forbidden label "${name}" on metric "${metricName}". Labels must be in the allow-list (no PII).`,
      );
    }
  }
}

function counter(name: string, help: string, labelNames: string[] = []): Counter<string> {
  assertLabelsAllowed(labelNames, name);
  return new Counter({ name, help, labelNames, registers: [registry] });
}

function gauge(name: string, help: string, labelNames: string[] = []): Gauge<string> {
  assertLabelsAllowed(labelNames, name);
  return new Gauge({ name, help, labelNames, registers: [registry] });
}

function histogram(name: string, help: string, labelNames: string[] = []): Histogram<string> {
  assertLabelsAllowed(labelNames, name);
  return new Histogram({ name, help, labelNames, registers: [registry] });
}

export const metrics = {
  authLinksTotal: counter('auth_links_total', 'Linking attempts', ['method_type', 'result']),
  authLoginsTotal: counter('auth_logins_total', 'Login attempts', ['method_type', 'result']),
  authActiveUsers30d: gauge('auth_active_users_30d', 'Users with last_login_at in last 30 days'),
  authInvitationsCreatedTotal: counter('auth_invitations_created_total', 'Invitations created', [
    'role',
  ]),
  authInvitationsRedeemedTotal: counter('auth_invitations_redeemed_total', 'Invitations redeemed', [
    'role',
  ]),
  authJwtIssuedTotal: counter('auth_jwt_issued_total', 'Tokens issued', ['kind']),
  authRecoveryAttemptsTotal: counter('auth_recovery_attempts_total', 'Recovery attempts', [
    'result',
  ]),
  authAdminActionsTotal: counter('auth_admin_actions_total', 'Admin actions', ['action']),
  authRequestDurationSeconds: histogram('auth_request_duration_seconds', 'HTTP request latency', [
    'route',
    'method',
    'status_class',
  ]),
  authRefreshReuseDetectedTotal: counter(
    'auth_refresh_reuse_detected_total',
    'Refresh token reuse detected — all tokens in the family have been revoked',
    [],
  ),
  authStepUpStartedTotal: counter('auth_step_up_started_total', 'Step-up /start invocations', [
    'method_type',
    'tier',
  ]),
  authStepUpFinishedTotal: counter('auth_step_up_finished_total', 'Step-up /finish invocations', [
    'method_type',
    'tier',
    'result',
  ]),
  authPairingCodesCreatedTotal: counter(
    'auth_pairing_codes_created_total',
    'Pairing codes created via POST /api/v1/me/pairing-codes',
  ),
  authPairingCodesRevokedTotal: counter(
    'auth_pairing_codes_revoked_total',
    'Pairing codes revoked via DELETE /api/v1/me/pairing-codes/:id',
  ),
  authPairingCodesRedeemedTotal: counter(
    'auth_pairing_codes_redeemed_total',
    'Pairing codes redeemed via POST /api/v1/join/finish (kind=pairing)',
  ),
  authWrappingInvariantViolationsTotal: counter(
    'auth_wrapping_invariant_violations_total',
    'OPAQUE wrapping integrity check failures (should be zero in steady state)',
    ['reason'],
  ),
};

export function initialiseMetrics(): void {
  // Calling this from server.ts ensures the metric registry is constructed
  // (it's already constructed at module-load time; this is a marker for
  // anyone reading server.ts).
}

export async function renderMetrics(): Promise<{ body: string; contentType: string }> {
  return { body: await registry.metrics(), contentType: registry.contentType };
}
