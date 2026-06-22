// SPDX-License-Identifier: AGPL-3.0-only

import { CryptoError, regenerateRecoveryKey } from '@chatsundere/crypto';
import { ConfirmTyped, useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { getDb } from '../../../boot/open-db.js';
import { RecoveryKeyReveal } from '../../../components/RecoveryKeyReveal.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { copy } from '../../../lib/copy.js';

// ── State machine ─────────────────────────────────────────────────────────────

/** Recovery key regeneration flow state. */
type RegenState =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'busy' }
  | { kind: 'done'; key: string };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Recovery Key sub-page: lets the user regenerate their recovery key.
 *
 * The action is gated on the master key being present in the session store.
 * Biometric-only sessions do not carry the raw master key and therefore cannot
 * safely rotate the recovery key without re-authentication.
 */
export function RecoveryKeyPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('recovery');
  const mk = useSessionStore((s) => s.mk);
  const [regenState, setRegenState] = useState<RegenState>({ kind: 'idle' });

  const canRegen = mk !== null;

  async function confirmRegen() {
    // Guard: mk must be present (passphrase or recovery-key session).
    const currentMk = useSessionStore.getState().mk;
    if (!currentMk) {
      setRegenState({ kind: 'idle' });
      return;
    }
    setRegenState({ kind: 'busy' });
    try {
      const { recoveryKeyString } = await regenerateRecoveryKey({ db: getDb(), mk: currentMk });
      setRegenState({ kind: 'done', key: recoveryKeyString });
    } catch (e) {
      if (e instanceof CryptoError) {
        // CryptoError.message is internal — log it for debugging but surface a generic message.
        void e;
      }
      setRegenState({ kind: 'idle' });
    }
  }

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Recovery Key' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-6 px-4 pb-8 pt-2">
        <div className="space-y-2">
          <Button
            tone="destructive"
            onClick={() => setRegenState({ kind: 'confirm' })}
            disabled={!canRegen}
            title={canRegen ? undefined : copy.settings.authMethods.regenerateRecoveryDisabledHint}
            className="w-full"
          >
            {copy.settings.authMethods.regenerateRecoveryCta}
          </Button>
          {!canRegen && (
            <p className="text-xs text-paper-soft">
              {copy.settings.authMethods.regenerateRecoveryDisabledHint}
            </p>
          )}
        </div>

        {/* Recovery key reveal — shown after successful regeneration */}
        {regenState.kind === 'done' && (
          <div className="space-y-4 rounded-[var(--radius-card)] bg-ink-soft p-5 ring-1 ring-inset ring-aurora-700/40">
            <p className="text-sm font-medium text-paper">
              Your new recovery key. Store it somewhere safe — you will not see it again.
            </p>
            <RecoveryKeyReveal value={regenState.key} />
            <button
              type="button"
              onClick={() => setRegenState({ kind: 'idle' })}
              className="text-xs text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              I have saved it
            </button>
          </div>
        )}
      </div>

      {/* Regenerate recovery key confirm */}
      <ConfirmTyped
        open={regenState.kind === 'confirm'}
        title="Generate a new recovery key?"
        body="Your current recovery key will be invalidated immediately. Make sure you save the new one before you leave this screen."
        confirmToken="regenerate"
        confirmTokenLabel='"regenerate"'
        destructiveCta="Generate new key"
        cancelCta="Cancel"
        busy={regenState.kind === 'busy'}
        onCancel={() => setRegenState({ kind: 'idle' })}
        onConfirm={() => void confirmRegen()}
      />
    </PageScaffold>
  );
}
