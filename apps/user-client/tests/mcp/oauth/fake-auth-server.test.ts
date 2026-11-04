// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createPkce } from '../../../src/mcp/oauth/pkce.js';
import { type FakeAuthOptions, createFakeAuthServer } from './fake-auth-server.js';

const REDIRECT = 'https://app.example/oauth/callback';

type Pair = { access_token: string; refresh_token?: string };

function form(fields: Record<string, string>): RequestInit {
  return { method: 'POST', body: new URLSearchParams(fields).toString() };
}

async function signIn(fake: ReturnType<typeof createFakeAuthServer>): Promise<Pair> {
  const pkce = await createPkce();
  const { code } = await fake.state.authorise({
    redirectUri: REDIRECT,
    state: 's',
    codeChallenge: pkce.challenge,
  });
  const res = await fake.fetch(
    fake.state.urls.token,
    form({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: pkce.verifier,
    }),
  );
  return (await res.json()) as Pair;
}

async function refresh(fake: ReturnType<typeof createFakeAuthServer>, token: string) {
  const res = await fake.fetch(
    fake.state.urls.token,
    form({ grant_type: 'refresh_token', refresh_token: token }),
  );
  return { status: res.status, body: (await res.json()) as Pair };
}

function make(options: FakeAuthOptions = {}) {
  return createFakeAuthServer({ now: () => 1_000_000, ...options });
}

describe('fake authorisation server', () => {
  it('rotates and records attempts', async () => {
    const fake = make();
    const first = await signIn(fake);
    const second = await refresh(fake, first.refresh_token ?? '');
    expect(second.body.refresh_token).toBeDefined();
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect(fake.state.refreshAttempts.map((a) => a.outcome)).toEqual(['ok']);
    expect(fake.state.familyRevoked).toBe(false);
  });

  it('never marks the token used when rotation is off', async () => {
    const fake = make({ rotate: false });
    const first = await signIn(fake);
    const token = first.refresh_token ?? '';
    for (let i = 0; i < 3; i++) expect((await refresh(fake, token)).status).toBe(200);
    expect(fake.state.refreshAttempts.map((a) => a.outcome)).toEqual(['ok', 'ok', 'ok']);
    expect(fake.state.familyRevoked).toBe(false);
  });

  it('replays inside the grace window and revokes after it', async () => {
    let t = 1_000_000;
    const fake = createFakeAuthServer({ graceSeconds: 30, now: () => t });
    const token = (await signIn(fake)).refresh_token ?? '';
    await refresh(fake, token);
    t += 10_000;
    expect((await refresh(fake, token)).status).toBe(200);
    t += 25_000;
    expect((await refresh(fake, token)).status).toBe(400);
    expect(fake.state.refreshAttempts.map((a) => a.outcome)).toEqual([
      'ok',
      'replayed',
      'reuse-revoked',
    ]);
    expect(fake.state.familyRevoked).toBe(true);
  });

  it('means no grace at all for graceSeconds 0, even with a frozen clock', async () => {
    const fake = make({ graceSeconds: 0 });
    const token = (await signIn(fake)).refresh_token ?? '';
    await refresh(fake, token);
    expect((await refresh(fake, token)).status).toBe(400);
    expect(fake.state.refreshAttempts.map((a) => a.outcome)).toEqual(['ok', 'reuse-revoked']);
    expect(fake.state.familyRevoked).toBe(true);
  });

  it('revokes the live family for an earlier-family token, even if that family is revoked', async () => {
    const fake = make();
    const a = await signIn(fake);
    const b = await signIn(fake);
    await fake.fetch(fake.state.urls.revocation, form({ token: a.refresh_token ?? '' }));
    expect(fake.state.revocations).toBe(1);
    await refresh(fake, a.refresh_token ?? '');
    expect(fake.state.refreshAttempts.at(-1)?.outcome).toBe('stale-family-revoked');
    expect(fake.state.revocations).toBe(2);
    expect((await refresh(fake, b.refresh_token ?? '')).status).toBe(400);
  });

  it('rejects the access tokens of a revoked family at the MCP endpoint', async () => {
    const fake = make();
    const pair = await signIn(fake);
    const call = () =>
      fake.fetch(fake.state.urls.mcp, {
        method: 'POST',
        headers: { authorization: `Bearer ${pair.access_token}` },
        body: '{}',
      });
    expect((await call()).status).toBe(200);
    await fake.fetch(fake.state.urls.revocation, form({ token: pair.refresh_token ?? '' }));
    expect((await call()).status).toBe(401);
  });

  it('binds codes to PKCE, single use and lifetime', async () => {
    let t = 1_000_000;
    const fake = createFakeAuthServer({ codeLifetimeSeconds: 10, now: () => t });
    const pkce = await createPkce();
    const mint = () =>
      fake.state.authorise({ redirectUri: REDIRECT, state: 's', codeChallenge: pkce.challenge });
    const exchange = async (code: string, verifier: string) =>
      (
        await fake.fetch(
          fake.state.urls.token,
          form({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT,
            code_verifier: verifier,
          }),
        )
      ).status;
    expect(await exchange((await mint()).code, 'wrong-verifier')).toBe(400);
    const good = (await mint()).code;
    expect(await exchange(good, pkce.verifier)).toBe(200);
    expect(await exchange(good, pkce.verifier)).toBe(400);
    const stale = (await mint()).code;
    t += 11_000;
    expect(await exchange(stale, pkce.verifier)).toBe(400);
  });

  it('spends the token but fails the client when the response is lost', async () => {
    const fake = make({ loseNextTokenResponse: true });
    const pkce = await createPkce();
    const { code } = await fake.state.authorise({
      redirectUri: REDIRECT,
      state: 's',
      codeChallenge: pkce.challenge,
    });
    const body = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: pkce.verifier,
    };
    await expect(fake.fetch(fake.state.urls.token, form(body))).rejects.toThrow(TypeError);
    expect((await fake.fetch(fake.state.urls.token, form(body))).status).toBe(400);
  });
});
