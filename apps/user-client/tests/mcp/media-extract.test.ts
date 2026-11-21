// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { extractMedia, isGenericFileName } from '../../src/mcp/media-extract.js';

const EL_URL =
  'https://elevenlabsusercontent.com/x/content.mp3?Expires=1795302000&KeyName=k&Signature=s';

const elevenLabsJson = (ids: string[]): string =>
  JSON.stringify({
    generations: ids.map((id) => ({
      generation_id: id,
      modality: 'audio',
      full_res_url: EL_URL.replace('/x/', `/${id}/`),
      preview_url: EL_URL.replace('/x/', `/${id}/`),
    })),
  });

describe('extractMedia: content blocks', () => {
  it('turns an audio block into a bytes ref', () => {
    const { refs, refused } = extractMedia({
      content: [{ type: 'audio', data: 'SUQz', mimeType: 'audio/mpeg' }],
    });
    expect(refused).toBe(0);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe('audio');
    expect(refs[0]?.mime).toBe('audio/mpeg');
    expect(refs[0]?.source).toEqual({ kind: 'bytes', base64: 'SUQz' });
    expect(refs[0]?.key.startsWith('bytes:')).toBe(true);
  });

  it('turns an embedded video resource blob into a bytes ref', () => {
    const { refs } = extractMedia({
      content: [{ type: 'resource', resource: { uri: 'x', mimeType: 'video/mp4', blob: 'AAAA' } }],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe('video');
    expect(refs[0]?.source.kind).toBe('bytes');
  });

  it('turns a resource_link into a url ref carrying a non-generic name', () => {
    const { refs } = extractMedia({
      content: [
        {
          type: 'resource_link',
          uri: 'https://cdn.example/a.webm',
          mimeType: 'video/webm',
          name: 'clip.webm',
        },
      ],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toEqual({ kind: 'url', url: 'https://cdn.example/a.webm' });
    expect(refs[0]?.providerName).toBe('clip.webm');
    expect(refs[0]?.key).toBe('url:https://cdn.example/a.webm');
  });

  it('drops a generic resource_link name', () => {
    const { refs } = extractMedia({
      content: [{ type: 'resource_link', uri: 'https://cdn.example/a.mp3', name: 'content.mp3' }],
    });
    expect(refs[0]?.providerName).toBeNull();
  });
});

describe('extractMedia: JSON in text and structuredContent', () => {
  it('reads an ElevenLabs generation once, with expiry and mime from the extension', () => {
    const { refs } = extractMedia({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            generations: [
              {
                generation_id: 'G1',
                modality: 'audio',
                full_res_url: EL_URL,
                preview_url: EL_URL,
              },
            ],
          }),
        },
      ],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.key).toBe('gen:G1');
    expect(refs[0]?.expiresAt).toBe(1795302000000);
    expect(refs[0]?.mime).toBe('audio/mpeg');
    expect(refs[0]?.kind).toBe('audio');
  });

  it('prefers full_res_url over preview_url within one generation', () => {
    const { refs } = extractMedia({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            generation_id: 'G9',
            preview_url: 'https://cdn.example/preview.mp3',
            full_res_url: 'https://cdn.example/full.mp3',
          }),
        },
      ],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toEqual({ kind: 'url', url: 'https://cdn.example/full.mp3' });
  });

  it('keeps several generations in source order', () => {
    const { refs } = extractMedia({
      content: [{ type: 'text', text: elevenLabsJson(['G1', 'G2']) }],
    });
    expect(refs.map((r) => r.key)).toEqual(['gen:G1', 'gen:G2']);
  });

  it('does not double refs found in both structuredContent and text', () => {
    const json = elevenLabsJson(['G1']);
    const { refs } = extractMedia({
      content: [{ type: 'text', text: json }],
      structuredContent: JSON.parse(json),
    });
    expect(refs).toHaveLength(1);
  });

  it('takes the mime from a sibling field when the URL has no extension', () => {
    const { refs } = extractMedia({
      structuredContent: { url: 'https://cdn.example/stream/42', mime_type: 'video/mp4' },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe('video');
    expect(refs[0]?.mime).toBe('video/mp4');
  });

  it('reads X-Amz-Date plus X-Amz-Expires as an expiry', () => {
    const { refs } = extractMedia({
      structuredContent: {
        url: 'https://b.example/a.mp4?X-Amz-Date=20261121T100000Z&X-Amz-Expires=3600',
      },
    });
    expect(refs[0]?.expiresAt).toBe(Date.UTC(2026, 10, 21, 11, 0, 0));
  });

  it('ignores media URLs in prose text', () => {
    const { refs, refused } = extractMedia({
      content: [{ type: 'text', text: 'Listen to https://cdn.example/song.mp3 now' }],
    });
    expect(refs).toEqual([]);
    expect(refused).toBe(0);
  });
});

describe('extractMedia: refusals', () => {
  it('ignores http: and javascript: URLs silently', () => {
    const { refs, refused } = extractMedia({
      structuredContent: {
        a: 'http://cdn.example/a.mp3',
        b: 'javascript:alert(1)//a.mp3',
      },
    });
    expect(refs).toEqual([]);
    expect(refused).toBe(0);
  });

  it('refuses an svg URL and an svg resource_link', () => {
    const { refs, refused } = extractMedia({
      content: [
        { type: 'resource_link', uri: 'https://cdn.example/pic.svg', name: 'pic' },
        {
          type: 'resource_link',
          uri: 'https://cdn.example/pic',
          mimeType: 'image/svg+xml',
          name: 'pic2',
        },
      ],
    });
    expect(refs).toEqual([]);
    expect(refused).toBe(2);
  });
});

describe('extractMedia: refusal precision', () => {
  it('neither plays nor counts non-media mimes', () => {
    const { refs, refused } = extractMedia({
      content: [{ type: 'resource_link', uri: 'https://x.example/a.png', mimeType: 'image/png' }],
      structuredContent: { url: 'https://x.example/a.png', mime_type: 'image/png' },
    });
    expect(refs).toHaveLength(0);
    expect(refused).toBe(0);
  });

  it('applies a sibling mime only to the main URL field, not a thumbnail', () => {
    const { refs } = extractMedia({
      structuredContent: {
        url: 'https://x.example/a.mp4',
        thumbnail: 'https://x.example/a.jpg',
        mime_type: 'video/mp4',
      },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.source).toEqual({ kind: 'url', url: 'https://x.example/a.mp4' });
  });

  it('counts the same refused offer once across text and structuredContent', () => {
    const json = { url: 'https://x.example/pic.svg' };
    const { refused } = extractMedia({
      content: [{ type: 'text', text: JSON.stringify(json) }],
      structuredContent: json,
    });
    expect(refused).toBe(1);
  });

  it('refuses a bytes block with a disallowed audio mime', () => {
    const { refs, refused } = extractMedia({
      content: [{ type: 'audio', data: 'SUQz', mimeType: 'audio/midi' }],
    });
    expect(refs).toHaveLength(0);
    expect(refused).toBe(1);
  });
});

describe('isGenericFileName', () => {
  it('flags generic names', () => {
    expect(isGenericFileName('content.mp3')).toBe(true);
    expect(isGenericFileName('3f2a9c1e.mp4')).toBe(true);
    expect(isGenericFileName('3f2a9c1e-5b7d-4e1a-9c3b-0a1b2c3d4e5f.wav')).toBe(true);
  });
  it('keeps human names', () => {
    expect(isGenericFileName('Lina teaser.mp3')).toBe(false);
  });
});
