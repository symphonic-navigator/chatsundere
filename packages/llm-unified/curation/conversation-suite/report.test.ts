// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { type SuiteRun, renderSuiteReport } from './report.js';

const run: SuiteRun = {
  scenarioId: 'core',
  offeringRef: 'nano:glm-5.1',
  permutations: [
    {
      label: 'reasoning-off',
      turns: [
        {
          turnId: 'tool-call-generate-image',
          results: [
            { assertion: 'no-http-error', status: 'pass', detail: 'HTTP 200' },
            { assertion: 'tool-call-fired:generate_image', status: 'fail', detail: 'did not fire' },
          ],
        },
      ],
    },
  ],
};

describe('renderSuiteReport', () => {
  test('reports an overall FAIL when any assertion fails', () => {
    const md = renderSuiteReport(run);
    expect(md).toContain('FAIL');
    expect(md).toContain('tool-call-fired:generate_image');
  });
  test('summarises the offering ref and permutation labels', () => {
    const md = renderSuiteReport(run);
    expect(md).toContain('nano:glm-5.1');
    expect(md).toContain('reasoning-off');
  });
  test('reports an overall PASS when every assertion passes', () => {
    const allPass: SuiteRun = {
      scenarioId: 'core',
      offeringRef: 'nano:glm-5.1',
      permutations: [
        {
          label: 'reasoning-off',
          turns: [
            {
              turnId: 'plain-completion',
              results: [{ assertion: 'no-http-error', status: 'pass', detail: 'HTTP 200' }],
            },
          ],
        },
      ],
    };
    const md = renderSuiteReport(allPass);
    expect(md).toContain('PASS');
    expect(md).not.toContain('FAIL');
  });
});
