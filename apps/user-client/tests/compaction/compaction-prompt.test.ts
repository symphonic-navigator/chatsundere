// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  buildCompactionTranscript,
  validateSummary,
} from '../../src/compaction/compaction-prompt.js';

const SIX = `## Topic & Goal
x
## Established Facts
x
## Open Threads
x
## User Preferences Observed
x
## Pending References
x
## Tone & Persona Adherence
x`;

describe('validateSummary', () => {
  it('accepts a briefing with all six headings', () => {
    expect(validateSummary(SIX)).toEqual({ ok: true, missing: [] });
  });
  it('reports missing headings', () => {
    const r = validateSummary('## Topic & Goal\nx');
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('Established Facts');
  });
  it('is tolerant of heading-case variation', () => {
    expect(validateSummary(SIX.toLowerCase()).ok).toBe(true);
  });
});

describe('buildCompactionTranscript', () => {
  it('renders user/persona turns and surfaces refs, never raw tool output', () => {
    const t = buildCompactionTranscript(
      [
        { role: 'user', text: 'show me the readme', refs: ['attachment'] },
        { role: 'persona', text: 'it describes deployment', refs: [] },
      ],
      null,
    );
    expect(t).toContain('it describes deployment');
    expect(t).toContain('[attachment]');
  });
  it('folds a previous summary in as Previous Story', () => {
    const t = buildCompactionTranscript([{ role: 'user', text: 'hi', refs: [] }], 'OLD STORY');
    expect(t).toContain('Previous Story');
    expect(t).toContain('OLD STORY');
  });
});
