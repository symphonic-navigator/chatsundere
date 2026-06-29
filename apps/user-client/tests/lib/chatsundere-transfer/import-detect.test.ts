// @vitest-environment node
import { expect, it } from 'vitest';
import { readManifestFormat } from '../../../src/lib/chatsundere-transfer/import-detect.js';
import {
  type ExportedPersona,
  type PersonaPackPayload,
  writePersonaPack,
} from '../../../src/lib/chatsundere-transfer/persona-pack.js';

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

it('detects a chatsundere persona archive from its manifest', async () => {
  const blob = await writePersonaPack(minimalPayload());
  expect(await readManifestFormat(blob)).toBe('chatsundere/persona');
});

it('returns unknown for a non-archive file', async () => {
  expect(await readManifestFormat(new Blob([new Uint8Array([0, 1, 2])]))).toBe('unknown');
});
