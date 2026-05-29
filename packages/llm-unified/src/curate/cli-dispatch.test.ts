// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parseArgs } from './cli-dispatch.js';

describe('parseArgs', () => {
  it('parses provider list', () => {
    expect(parseArgs(['provider', 'list'])).toEqual({ kind: 'provider-list' });
  });
  it('parses model template with refs', () => {
    expect(parseArgs(['model', 'template', 'nano-gpt:zai-org/glm-6'])).toEqual({
      kind: 'model-template',
      refs: ['nano-gpt:zai-org/glm-6'],
    });
  });
  it('parses model build with --verify', () => {
    expect(parseArgs(['model', 'build', 'models/glm-6.yaml', '--verify'])).toEqual({
      kind: 'model-build',
      file: 'models/glm-6.yaml',
      verify: true,
    });
  });
  it('parses model verify --all', () => {
    expect(parseArgs(['model', 'verify', '--all'])).toEqual({
      kind: 'model-verify',
      all: true,
      ref: null,
    });
  });
  it('returns help for empty or --help', () => {
    expect(parseArgs([]).kind).toBe('help');
    expect(parseArgs(['--help']).kind).toBe('help');
  });
  it('returns help for an unknown command', () => {
    expect(parseArgs(['frobnicate']).kind).toBe('help');
  });
});
