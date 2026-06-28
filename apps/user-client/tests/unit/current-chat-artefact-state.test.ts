// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

test('artefact lightbox state toggles', () => {
  const s = useCurrentChatStore.getState();
  s.openArtefact('a1');
  expect(useCurrentChatStore.getState().openArtefactId).toBe('a1');
  s.closeArtefact();
  expect(useCurrentChatStore.getState().openArtefactId).toBeNull();
});
