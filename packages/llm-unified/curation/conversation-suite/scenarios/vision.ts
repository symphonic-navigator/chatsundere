// SPDX-License-Identifier: LGPL-3.0-only
import {
  assertNoHttpError,
  assertNoStreamError,
  assertUsagePresent,
  assertVisionDescribed,
} from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';
import { SYLVIR_IMAGE_DATA_URL } from './_test-image.js';

/**
 * The vision scenario — run ONLY against offerings whose `profile.vision` is
 * true (the curator selects it; text-only models would reject an image part).
 * It exercises the image-input pipe: a multimodal `user` message (text + image)
 * is carried through and the model names the image's unambiguous content. Purely
 * a protocol check (design D8): it judges that the bytes flow, not the model's
 * visual acuity.
 *
 * The image is a content-rich photo (a half-elf bard in a green cloak), NOT a
 * synthetic solid-colour block. A uniform colour gave MiMo V2.5 nothing to
 * perceive, so it leaked chain-of-thought into the content channel and rambled
 * past the bare colour word (~88% pass); the real photo lands "green" reliably
 * (12/12 live on MiMo Omni) because the question — the colour of the clothing —
 * has an unambiguous answer the model states even when verbose. See
 * `_test-image.ts`.
 */
export const visionScenario: ConversationScenario = {
  id: 'vision',
  description:
    'Single image-input turn: the image is carried through and the clothing colour described.',
  turns: [
    {
      id: 'image-colour',
      send: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What is the dominant colour of the clothing worn by the figure in this image? Reply with the single colour word.',
            },
            { type: 'image_url', image_url: { url: SYLVIR_IMAGE_DATA_URL } },
          ],
        },
      ],
      assertions: [
        assertNoHttpError,
        assertNoStreamError,
        assertVisionDescribed('green'),
        assertUsagePresent,
      ],
    },
  ],
};
