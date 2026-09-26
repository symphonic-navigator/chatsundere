// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import {
  POST_UPDATE_RETURN_KEY,
  _resetPostUpdateReturnForTests,
  consumeReturnPath,
  rememberReturnPath,
} from '../../src/sw/post-update-return.js';

describe('post-update-return (spec 2026-09-26 §3.3)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    _resetPostUpdateReturnForTests();
  });

  it('round-trips an app path and clears the storage key', () => {
    rememberReturnPath('/app/chat/c1?x=1');
    expect(consumeReturnPath()).toBe('/app/chat/c1?x=1');
    expect(sessionStorage.getItem(POST_UPDATE_RETURN_KEY)).toBeNull();
  });

  it('memoises the first result for the page lifetime (StrictMode double-invoke)', () => {
    rememberReturnPath('/app/chat/c1');
    expect(consumeReturnPath()).toBe('/app/chat/c1');
    expect(consumeReturnPath()).toBe('/app/chat/c1');
  });

  it('does not pick up a value stored after the first consume', () => {
    expect(consumeReturnPath()).toBeNull();
    rememberReturnPath('/app/chat/c2');
    expect(consumeReturnPath()).toBeNull();
  });

  it('never stores a non-app path (no loop back to /login)', () => {
    rememberReturnPath('/login');
    expect(consumeReturnPath()).toBeNull();
  });

  it('never stores a path that merely starts with /app', () => {
    rememberReturnPath('/application');
    expect(sessionStorage.getItem(POST_UPDATE_RETURN_KEY)).toBeNull();
  });

  it('accepts exactly /app', () => {
    rememberReturnPath('/app');
    expect(consumeReturnPath()).toBe('/app');
  });

  it('rejects a tampered lookalike on read', () => {
    sessionStorage.setItem(POST_UPDATE_RETURN_KEY, '/appx/evil');
    expect(consumeReturnPath()).toBeNull();
  });

  it('rejects a tampered unsafe value', () => {
    sessionStorage.setItem(POST_UPDATE_RETURN_KEY, '//evil.example');
    expect(consumeReturnPath()).toBeNull();
  });
});
