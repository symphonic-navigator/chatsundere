import { describe, expect, it } from 'vitest';
import type { MessageRow } from '../../src/boot/client-data-db.js';
import { resolveOpenerContext } from '../../src/lib/stream-engine.js';

const opener = (text: string): MessageRow =>
  ({ role: 'persona', kind: 'opener', contentBlocks: [{ type: 'text', text }] }) as MessageRow;
const seedGreeting = (text: string): MessageRow =>
  ({
    role: 'persona',
    kind: 'seed',
    seedRole: 'greeting',
    contentBlocks: [{ type: 'text', text }],
  }) as MessageRow;
const userMsg = (text: string): MessageRow =>
  ({ role: 'user', contentBlocks: [{ type: 'text', text }] }) as MessageRow;

describe('resolveOpenerContext', () => {
  it('returns the opener text for a chat job', () => {
    expect(resolveOpenerContext([opener('Welcome.'), userMsg('hi')], 'chat')).toBe('Welcome.');
  });
  it('returns empty for a greeting job', () => {
    expect(resolveOpenerContext([opener('Welcome.')], 'greeting')).toBe('');
  });
  it('returns empty when there is no opener', () => {
    expect(resolveOpenerContext([userMsg('hi')], 'chat')).toBe('');
  });
  it('echoes a seed greeting like an opener', () => {
    expect(resolveOpenerContext([seedGreeting('Oh, you again.'), userMsg('hi')], 'chat')).toBe(
      'Oh, you again.',
    );
  });
});
