// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import type { ProviderConfig } from '../types.js';
import { TranscriptionError, transcribeAudio } from './transcribe-audio.js';

const provider: ProviderConfig = {
  baseUrl: 'https://api.mistral.test/v1',
  routing: { kind: 'direct' },
};

function args(fetchFn: typeof fetch, mimeType = 'audio/webm;codecs=opus') {
  return {
    providerConfig: provider,
    apiKey: 'k',
    corsProxyUrl: null,
    corsProxyKey: null,
    upstreamSlug: 'voxtral-mini-latest',
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }),
    mimeType,
    fetchFn,
  };
}

describe('transcribeAudio', () => {
  test('posts multipart with model + file and returns the text', async () => {
    let captured: Request | null = null;
    const fetchFn = (async (req: Request) => {
      captured = req;
      return new Response(JSON.stringify({ text: ' hello there ' }), { status: 200 });
    }) as typeof fetch;
    const result = await transcribeAudio(args(fetchFn));
    expect(result.text).toBe('hello there');
    const sentReq = captured as Request | null;
    expect(sentReq?.url).toBe('https://api.mistral.test/v1/audio/transcriptions');
    const form = await sentReq?.formData();
    expect(form?.get('model')).toBe('voxtral-mini-latest');
    const file = form?.get('file') as File;
    expect(file.name).toBe('recording.webm');
  });

  test('wav mime maps to recording.wav', async () => {
    let name = '';
    const fetchFn = (async (req: Request) => {
      const form = await req.formData();
      name = (form.get('file') as File).name;
      return new Response(JSON.stringify({ text: 'x' }), { status: 200 });
    }) as typeof fetch;
    await transcribeAudio(args(fetchFn, 'audio/wav'));
    expect(name).toBe('recording.wav');
  });

  test('mp4 mime maps to recording.m4a', async () => {
    let name = '';
    const fetchFn = (async (req: Request) => {
      const form = await req.formData();
      name = (form.get('file') as File).name;
      return new Response(JSON.stringify({ text: 'x' }), { status: 200 });
    }) as typeof fetch;
    await transcribeAudio(args(fetchFn, 'audio/mp4'));
    expect(name).toBe('recording.m4a');
  });

  test('HTTP error throws TranscriptionError with status', async () => {
    const fetchFn = (async () => new Response('nope', { status: 429 })) as unknown as typeof fetch;
    await expect(transcribeAudio(args(fetchFn))).rejects.toThrow(TranscriptionError);
    const err = await transcribeAudio(args(fetchFn)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).status).toBe(429);
  });

  test('missing text field throws TranscriptionError(null)', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 })) as unknown as typeof fetch;
    await expect(transcribeAudio(args(fetchFn))).rejects.toThrow(TranscriptionError);
    const err = await transcribeAudio(args(fetchFn)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TranscriptionError);
    expect((err as TranscriptionError).status).toBeNull();
  });
});
