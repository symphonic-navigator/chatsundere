// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { treasuryCountLabel } from '../../src/lib/treasury-count.js';

test('no artefacts at all → empty', () => {
  expect(treasuryCountLabel(0, 0)).toBe('empty');
});

test('nothing filtered out → total artefacts', () => {
  expect(treasuryCountLabel(5, 5)).toBe('5 artefacts');
});

test('a filter narrows the set → N of M', () => {
  expect(treasuryCountLabel(5, 2)).toBe('2 of 5');
});

test('a filter matching none → 0 of M', () => {
  expect(treasuryCountLabel(5, 0)).toBe('0 of 5');
});

test('defensive: filtered exceeding total still reads as total artefacts', () => {
  expect(treasuryCountLabel(3, 99)).toBe('3 artefacts');
});
