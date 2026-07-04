// SPDX-License-Identifier: AGPL-3.0-only
import { setProxyAuthSource } from '@chatsundere/llm-unified';
import { initAccountLinkFromDb, maybeProbeLinkedServer } from '@chatsundere/ui-shared';
import { armAuthDegradeFromBoot } from '../lib/auth-degrade.js';
import { proxyAuthSource } from '../lib/proxy-auth.js';
import { armBackfillIfCorpusUnsynced, runBackfillIfPending } from '../sync/backfill.js';
import { initDoorbell } from '../sync/doorbell.js';
import { runRecovery } from '../sync/recovery.js';
import { initSyncTriggers } from '../sync/triggers.js';
import { _setBackfill, _setRecovery } from '../sync/worker.js';
import { getDb } from './open-db.js';

/**
 * WS-0 + WS-C boot wiring. WS-0 (spec §7): register the late-binding proxy auth
 * source, populate the central account-link gate from the crypto IDB, then fire
 * the initial discovery probe (a no-op when local-only or offline). WS-C
 * (sync-engine spec §6/§8/§9), wired AFTER the WS-0 init and additively:
 * register epoch recovery on the worker's authenticated-mismatch seam, install
 * the sync triggers (immediate-drain registration, boot cycle after unlock,
 * regain / foreground / timer / debounced Class-1 kick), and start the doorbell
 * consumer. Every WS-C piece is internally gated on linked + unlocked, so
 * installing them unconditionally at boot is safe.
 */
export async function initServerFoundation(): Promise<void> {
  setProxyAuthSource(proxyAuthSource);
  await initAccountLinkFromDb(getDb());
  maybeProbeLinkedServer();

  // WS-C: recovery runs ONLY from the worker's authenticated epoch-mismatch
  // handoff (never from a doorbell poke, Larissa M-4).
  _setRecovery(runRecovery);
  // Unit 1b rescue: on the first cycle that actually reaches the backfill
  // handoff this boot (i.e. once linked + unlocked + online), scan the whole
  // corpus once for un-transferred rows and arm `backfillPending` if any turn
  // up — this is what rescues a device that linked before the pump existed
  // (or otherwise missed arming). `corpusArmCheckDone` is scoped to this call
  // of `initServerFoundation` (one real boot, or one test), so the full-corpus
  // scan runs at most once per session, never on every cycle.
  let corpusArmCheckDone = false;
  _setBackfill(async () => {
    if (!corpusArmCheckDone) {
      corpusArmCheckDone = true;
      try {
        await armBackfillIfCorpusUnsynced();
      } catch {
        // Self-heals: corpusArmCheckDone stays true (never retried), and the
        // pump below still runs this cycle and every one after — a DB hiccup
        // on the one-off corpus scan must never skip that cycle's pump.
      }
    }
    await runBackfillIfPending();
  });
  // §5.2: re-arm the auth-degraded latch from the persisted attention BEFORE the
  // triggers fire the first cycle — a boot into a degraded state must not drain
  // or pull before the latch is restored (canRunCycle/gateOpen consult it).
  await armAuthDegradeFromBoot();
  initSyncTriggers();
  initDoorbell();
}
