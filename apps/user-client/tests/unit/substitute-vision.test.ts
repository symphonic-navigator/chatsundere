// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import {
  VISION_DESCRIBE_INSTRUCTION,
  describeImage,
} from '../../src/attachments/substitute-vision.js';

describe('describeImage', () => {
  it('sends the fixed instruction + image as a one-shot and returns the text', async () => {
    const runOneShot = vi.fn().mockResolvedValue('a red bicycle');
    const text = await describeImage({
      dataUrl: 'data:image/jpeg;base64,xxx',
      model: 'p:v',
      runOneShot,
      oneShotBase: { target: { slug: 'm' } } as never,
    });
    expect(text).toBe('a red bicycle');
    const call = runOneShot.mock.calls[0]?.[0];
    expect(call.messages[0].content).toEqual([
      { type: 'text', text: VISION_DESCRIBE_INSTRUCTION },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
    ]);
    // Conservative shape: reasoning off, low temperature.
    expect(call.bodyExtras.reasoning).toEqual({ enabled: false });
    expect(call.bodyExtras.temperature).toBe(0.2);
  });

  it('retries once on a first failure (cold start) then succeeds', async () => {
    const runOneShot = vi.fn().mockRejectedValueOnce(new Error('cold')).mockResolvedValue('ok');
    const text = await describeImage({
      dataUrl: 'd',
      model: 'm',
      runOneShot,
      oneShotBase: { target: {} } as never,
    });
    expect(text).toBe('ok');
    expect(runOneShot).toHaveBeenCalledTimes(2);
  });

  it('throws after a second failure', async () => {
    const runOneShot = vi.fn().mockRejectedValue(new Error('down'));
    await expect(
      describeImage({ dataUrl: 'd', model: 'm', runOneShot, oneShotBase: { target: {} } as never }),
    ).rejects.toThrow();
    expect(runOneShot).toHaveBeenCalledTimes(2);
  });
});
