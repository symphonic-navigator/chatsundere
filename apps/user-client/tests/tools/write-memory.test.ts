import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../src/memory/repo.js';
import { contributeMemoryTool } from '../../src/tools/write-memory.js';

describe('write_memory_entry', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('writes one uncommitted entry and fires onWritten on success', async () => {
    const add = vi.spyOn(repo, 'addJournalEntries').mockResolvedValue([{ id: 'e1' } as never]);
    vi.spyOn(repo, 'listJournal').mockResolvedValue([]);
    const onWritten = vi.fn();
    const [tool] = contributeMemoryTool({ personaId: 'p1', onWritten });
    const res = await tool.execute({ content: 'User has a cat named Mochi.' });
    expect(res.ok).toBe(true);
    expect(add).toHaveBeenCalledWith('p1', [
      { content: 'User has a cat named Mochi.', category: 'fact', isCorrection: false },
    ]);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it('marks corrections with category correction and isCorrection true', async () => {
    const add = vi.spyOn(repo, 'addJournalEntries').mockResolvedValue([{ id: 'e2' } as never]);
    vi.spyOn(repo, 'listJournal').mockResolvedValue([]);
    const [tool] = contributeMemoryTool({ personaId: 'p1' });
    await tool.execute({ content: 'User now prefers tea, not coffee.', correction: true });
    expect(add).toHaveBeenCalledWith('p1', [
      { content: 'User now prefers tea, not coffee.', category: 'correction', isCorrection: true },
    ]);
  });

  it('skips an exact case-insensitive duplicate without writing', async () => {
    const add = vi.spyOn(repo, 'addJournalEntries').mockResolvedValue([]);
    vi.spyOn(repo, 'listJournal').mockResolvedValue([
      { content: 'User has a cat named Mochi.', state: 'committed' } as never,
    ]);
    const onWritten = vi.fn();
    const [tool] = contributeMemoryTool({ personaId: 'p1', onWritten });
    const res = await tool.execute({ content: '  user has a CAT named mochi. ' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('Already remembered');
    expect(add).not.toHaveBeenCalled();
    expect(onWritten).not.toHaveBeenCalled();
  });

  it('fails cleanly on empty content', async () => {
    const [tool] = contributeMemoryTool({ personaId: 'p1' });
    const res = await tool.execute({ content: '   ' });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
