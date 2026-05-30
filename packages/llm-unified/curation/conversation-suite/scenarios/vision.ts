// SPDX-License-Identifier: LGPL-3.0-only
import {
  assertNoHttpError,
  assertNoStreamError,
  assertUsagePresent,
  assertVisionDescribed,
} from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

// A 128x128 solid pure-red (#FF0000) PNG as a data URL. Solid + unambiguous so
// the expected description ("red") is reliable. SIZE MATTERS: a 24x24 version was
// mis-perceived as "black" by Kimi K2.6 (its vision preprocessing mangled the
// tiny image) and even 400'd chutes streaming — at 128x128 every vision offering
// reports "red". Generated deterministically (zlib + struct), embedded so the
// suite needs no asset file.
const RED_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAxElEQVR42u3RMQ0AAAjAsPk3DTLgaDIFa1M6zAIAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABAADAAgAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAgAAAEAIAAABACAAAAQAAACAEAAAAjAixYgaMOy89oM6gAAAABJRU5ErkJggg==';

/**
 * The vision scenario — run ONLY against offerings whose `profile.vision` is
 * true (the curator selects it; text-only models would reject an image part).
 * It exercises the image-input pipe: a multimodal `user` message (text + image)
 * is carried through and the model names the image's unambiguous content. Purely
 * a protocol check (design D8): it judges that the bytes flow, not the model's
 * visual acuity.
 */
export const visionScenario: ConversationScenario = {
  id: 'vision',
  description: 'Single image-input turn: the image is carried through and its colour described.',
  turns: [
    {
      id: 'image-colour',
      send: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What is the dominant colour of this image? Reply with the single colour word.',
            },
            { type: 'image_url', image_url: { url: RED_PNG_DATA_URL } },
          ],
        },
      ],
      assertions: [
        assertNoHttpError,
        assertNoStreamError,
        assertVisionDescribed('red'),
        assertUsagePresent,
      ],
    },
  ],
};
