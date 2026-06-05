// SPDX-License-Identifier: AGPL-3.0-only
import type { OneShotArgs, WireMessage } from '@chatsundere/llm-unified';

/**
 * Fixed British-English instruction sent as the first content part of every
 * substitute-vision describe call. Kept as a named export so tests can assert
 * the exact string without coupling to the prompt wording in the test body.
 */
export const VISION_DESCRIBE_INSTRUCTION =
  'Please describe this image in detail: subjects, objects, layout, any visible text, ' +
  'colours, and the overall mood. Be specific and concrete. Do not add interpretation or ' +
  'advice — only what is in the image.';

export interface DescribeImageArgs {
  /** Base64 data-URL of the normalised JPEG to describe. */
  dataUrl: string;
  /** Substitute model ref "providerId:slug" — recorded in the cache + the injected note. */
  model: string;
  /** Caller-injected one-shot runner — keeps this module unit-testable without fetch. */
  runOneShot: (args: OneShotArgs) => Promise<string>;
  /** Everything in OneShotArgs except messages + bodyExtras (provider/key/proxy/target). */
  oneShotBase: Omit<OneShotArgs, 'messages' | 'bodyExtras'>;
}

/**
 * Ask the substitute vision model to describe an image. Sends a single one-shot
 * request with conservative body parameters (no reasoning, temperature 0.2) and
 * performs one silent retry on first failure for cold-start tolerance.
 */
export async function describeImage(args: DescribeImageArgs): Promise<string> {
  const messages: WireMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_DESCRIBE_INSTRUCTION },
        { type: 'image_url', image_url: { url: args.dataUrl } },
      ],
    },
  ];

  const call = () =>
    args.runOneShot({
      ...args.oneShotBase,
      messages,
      // Conservative: no reasoning, no tools, low temperature — a literal description.
      bodyExtras: { temperature: 0.2, max_tokens: 1024, reasoning: { enabled: false } },
    });

  try {
    return await call();
  } catch {
    return await call(); // second and final attempt
  }
}
