// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.js';
import { wipeDevice } from '../../lib/wipe-device.js';

/**
 * Start-over exit (spec §4.3).
 *
 * The honest, reachable escape from the locked login for the user who has lost
 * both passphrase and recovery key. It erases everything on this device behind a
 * typed confirmation, and says plainly that a synced server account is a
 * separate thing that is not touched here.
 */

// Test seam: lets a test assert the wipe fires without actually wiping. The
// codebase's `_set*` convention for injectable module-level dependencies.
let wipeImpl: () => Promise<void> = wipeDevice;

/** Override the wipe used on confirm. Test-only; pass `null` to restore. */
export function _setWipeForTests(fn: (() => Promise<void>) | null): void {
  wipeImpl = fn ?? wipeDevice;
}

// The exact phrase the user must type to arm the erase button. Matched
// case-insensitively and trimmed.
const CONFIRM_PHRASE = 'start over';

export function StartOver(): JSX.Element {
  const navigate = useNavigate();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);

  const armed = phrase.trim().toLowerCase() === CONFIRM_PHRASE;

  async function handleErase(): Promise<void> {
    if (!armed) return;
    setBusy(true);
    // wipeImpl reloads the page on success, so there is no path back to reset
    // `busy`; a failure would leave the button disabled, which is the safe side.
    await wipeImpl();
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1">
          <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
            Start over on this device
          </h1>
          <p className="text-sm text-paper-soft">
            This erases everything on this device — your chats, personas, settings, and local
            account. There is no way back without your passphrase or recovery key.
          </p>
          <p className="text-sm text-paper-soft">
            A synced server account is a separate thing and is not touched here. If you have one,
            you can rejoin it later on any device with your passphrase or recovery key.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="start-over-confirm" className="block text-sm text-paper-soft">
            Type <span className="font-mono text-paper">start over</span> to confirm
          </label>
          <input
            id="start-over-confirm"
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-base text-paper outline-none ring-1 ring-inset ring-aurora-700/40 focus:ring-aurora-500 disabled:opacity-50"
          />
        </div>

        <Button
          tone="destructive"
          disabled={!armed || busy}
          onClick={() => void handleErase()}
          className="w-full"
        >
          {busy ? 'Erasing…' : 'Erase this device'}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
          >
            Back to sign-in
          </button>
        </div>
      </div>
    </main>
  );
}
