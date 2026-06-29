// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { gzip, tar } from '../../../src/lib/archive/tar-write.js';
import {
  type ExportedPersona,
  type PersonaPackPayload,
  readPersonaPack,
  writePersonaPack,
} from '../../../src/lib/chatsundere-transfer/persona-pack.js';
import { gunzip, untar } from '../../../src/lib/chatsune-import/archive-reader.js';

function minimalPayload(): PersonaPackPayload {
  const persona: ExportedPersona = {
    name: 'Fable',
    tagline: 't',
    instructions: 'i',
    canonicalId: null,
    colour: '#fff',
    font: 'serif',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.7,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    askExpertDefault: false,
    roleplay: false,
    narration: 'third',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    useMemory: true,
    memoryInstructions: '',
    createdAt: 0,
    updatedAt: 0,
    modelRef: { providerTemplateId: 'tmpl', modelId: 'claude-opus-4-8' },
  };
  return {
    persona,
    avatar: null,
    chats: [],
    messages: [],
    pills: [],
    attachments: [],
    artefacts: [],
    checkpoints: [],
    memory: null,
    blobs: new Map(),
    included: { memory: false, artefacts: true, images: false },
  };
}

describe('writePersonaPack', () => {
  it('produces a gzipped tar whose manifest declares the persona format', async () => {
    const blob = await writePersonaPack(minimalPayload());
    const files = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    const names = files.map((f) => f.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('persona.json');
    const manifest = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.name === 'manifest.json')?.bytes),
    );
    expect(manifest.format).toBe('chatsundere/persona');
    expect(manifest.included).toEqual({ memory: false, artefacts: true, images: false });
  });

  it('never writes a provider key field into persona.json', async () => {
    const blob = await writePersonaPack(minimalPayload());
    const files = untar(await gunzip(new Uint8Array(await blob.arrayBuffer())));
    const persona = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.name === 'persona.json')?.bytes),
    );
    expect(persona.providerId).toBeUndefined();
    expect(persona.modelId).toBeUndefined();
    expect(persona.mcpOverrides).toBeUndefined();
    expect(persona.libraryIds).toBeUndefined();
    expect(persona.modelRef).toEqual({ providerTemplateId: 'tmpl', modelId: 'claude-opus-4-8' });
  });

  it('round-trips a payload through write → read (modulo binary maps)', async () => {
    const payload = minimalPayload();
    const blob = await writePersonaPack(payload);
    const { manifest, payload: out } = await readPersonaPack(blob);
    expect(manifest.format).toBe('chatsundere/persona');
    expect(out.persona).toEqual(payload.persona);
    expect(out.chats).toEqual(payload.chats);
    expect(out.included).toEqual(payload.included);
    expect(out.memory).toBeNull();
  });

  it('rejects a non-persona archive', async () => {
    await expect(readPersonaPack(new Uint8Array([0, 1, 2]))).rejects.toThrow();
  });

  it('rejects a well-formed archive whose manifest declares a different format', async () => {
    const wrongManifest = { format: 'chatsundere/knowledge', version: 1 };
    const bytes = await gzip(
      tar([
        { name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(wrongManifest)) },
      ]),
    );
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/gzip' });
    await expect(readPersonaPack(blob)).rejects.toThrow();
  });
});
