// SPDX-License-Identifier: LGPL-3.0-only
import { assertNoHttpError, assertUsagePresent, assertUsageWithinCap } from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * The sampling-cap probe. It verifies the CAP ARRIVED, not that the model
 * is terse: a provider reading sampling from a different place (ollama's
 * `options`) silently ignores an OpenAI-shaped cap and overruns it. The
 * cap itself is supplied by the binding's `sampling`, so this turn is only
 * meaningful when the binding sets `max_tokens: 16`.
 *
 * This lives in its OWN scenario, run with its OWN binding, rather than as a
 * turn in `coreScenario`: `coreScenario` is shared by all 13 `run-*-suite.ts`
 * runners, but only the ollama binding sets a sampling cap, so a shared
 * `sampling-cap` turn would false-fail on every other provider's next live
 * run. Worse, `binding.ts` applies `bodyExtras: { ...sampling, reasoning }`
 * to EVERY turn in a run — so a cap wired onto the core binding would also
 * truncate the reasoning-probe, tool-call and memory-echo turns to the same
 * tiny token count. Isolating the cap to its own scenario with its own
 * capped binding keeps it meaningful without collateral damage.
 */
export const samplingCapScenario: ConversationScenario = {
  id: 'sampling-cap',
  description: 'Single turn verifying a requested max_tokens cap actually reaches the upstream.',
  turns: [
    {
      id: 'sampling-cap',
      send: [{ role: 'user', content: 'Count from 1 to 40, separated by commas.' }],
      assertions: [assertNoHttpError, assertUsagePresent, assertUsageWithinCap(16)],
    },
  ],
};
