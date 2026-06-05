// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canSendImages, imageDisposition } from '../../src/attachments/vision-gate.js';

const visionLookup = (ref: string) =>
  ref === 'p:v'
    ? { profile: { vision: true } }
    : ref === 'p:nov'
      ? { profile: { vision: false } }
      : undefined;

describe('canSendImages', () => {
  it('active model with vision wins', () => {
    expect(canSendImages('p:v', null, visionLookup as never)).toBe(true);
  });
  it('non-vision active + vision substitute → true', () => {
    expect(canSendImages('p:nov', 'p:v', visionLookup as never)).toBe(true);
  });
  it('non-vision active + no substitute → false', () => {
    expect(canSendImages('p:nov', null, visionLookup as never)).toBe(false);
  });
  it('non-vision active + non-vision substitute → false', () => {
    expect(canSendImages('p:nov', 'p:nov', visionLookup as never)).toBe(false);
  });
});

describe('imageDisposition', () => {
  it('direct when active model sees', () => {
    expect(imageDisposition('p:v', 'p:v', visionLookup as never)).toBe('direct');
  });
  it('substitute when active blind but substitute sees', () => {
    expect(imageDisposition('p:nov', 'p:v', visionLookup as never)).toBe('substitute');
  });
  it('placeholder when neither sees', () => {
    expect(imageDisposition('p:nov', null, visionLookup as never)).toBe('placeholder');
  });
});
