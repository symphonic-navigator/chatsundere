// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from 'vitest';
import { codeSnippetTitle, messageSnippetTitle } from '../../src/lib/artefact-titles.js';

test('messageSnippetTitle collapses whitespace and trims', () => {
  expect(messageSnippetTitle('  hello   world\n\nagain ')).toBe('hello world again');
});

test('messageSnippetTitle truncates long text with an ellipsis', () => {
  const title = messageSnippetTitle('x'.repeat(80));
  expect(title.length).toBe(51); // 50 chars + …
  expect(title.endsWith('…')).toBe(true);
});

test('messageSnippetTitle falls back when empty', () => {
  expect(messageSnippetTitle('   \n  ')).toBe('Saved message');
});

test('codeSnippetTitle uses the first non-empty line', () => {
  expect(codeSnippetTitle('\n\n  def main():\n  pass', 'python')).toBe('def main():');
});

test('codeSnippetTitle truncates a long first line', () => {
  const title = codeSnippetTitle(`${'a'.repeat(80)}\nrest`, 'python');
  expect(title.length).toBe(51);
  expect(title.endsWith('…')).toBe(true);
});

test('codeSnippetTitle falls back to "<lang> snippet" when empty', () => {
  expect(codeSnippetTitle('   \n  ', 'python')).toBe('python snippet');
});
