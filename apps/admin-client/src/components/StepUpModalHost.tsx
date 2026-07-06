// SPDX-License-Identifier: AGPL-3.0-only

import { openLocalDb, stepUpWithPassphrase } from '@chatsundere/crypto';
import { StepUpModal, useSessionStore, useStepUpStore } from '@chatsundere/ui-shared';
import { copy } from '../copy.js';
import { httpServerClient } from '../lib/server-client.js';

/**
 * Admin step-up host: passphrase-only (Mechanism B). The admin-client has no
 * passkey infrastructure; OPAQUE is universally available per ADR 0021.
 * Tier-4 grace (5 min) makes invitation burst-work one prompt per burst.
 */
export function StepUpModalHost() {
  const pending = useStepUpStore((s) => s.pending);
  const tier = pending?.tier ?? 't4';

  return (
    <StepUpModal
      passkeyAvailable={false}
      onPassphrase={async (passphrase) =>
        stepUpWithPassphrase({
          db: await openLocalDb(),
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
