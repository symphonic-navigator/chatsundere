// SPDX-License-Identifier: AGPL-3.0-only

import {
  listPasskeyCredentials,
  stepUpWithPasskey,
  stepUpWithPassphrase,
} from '@chatsundere/crypto';
import { StepUpModal, useSessionStore, useStepUpStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { getDb } from '../boot/open-db.js';
import { copy } from '../lib/copy.js';
import { httpServerClient } from '../lib/server-client.js';
import { getStepUpAssertion } from '../lib/step-up-assertion.js';
import { isWebAuthnAvailable } from '../lib/webauthn-availability.js';

/**
 * Mounts the shared StepUpModal once at the app root and wires both
 * mechanisms (spec §7.2). Passkey availability is local knowledge: a
 * server-synced passkey row plus WebAuthn support — no server round-trip.
 */
export function StepUpModalHost() {
  const pending = useStepUpStore((s) => s.pending);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPasskeyCredentials(getDb());
        if (!cancelled) {
          setPasskeyAvailable(isWebAuthnAvailable() && rows.some((r) => r.is_synced_with_server));
        }
      } catch {
        if (!cancelled) setPasskeyAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const tier = pending?.tier ?? 't1';

  return (
    <StepUpModal
      passkeyAvailable={passkeyAvailable}
      onPasskey={() =>
        stepUpWithPasskey({
          db: getDb(),
          serverClient: httpServerClient,
          accessToken: useSessionStore.getState().session?.accessToken ?? '',
          tier,
          getAssertion: getStepUpAssertion,
        })
      }
      onPassphrase={(passphrase) =>
        stepUpWithPassphrase({
          db: getDb(),
          serverClient: httpServerClient,
          accessToken: useSessionStore.getState().session?.accessToken ?? '',
          tier,
          passphrase,
        })
      }
      copy={copy.stepUp}
    />
  );
}
