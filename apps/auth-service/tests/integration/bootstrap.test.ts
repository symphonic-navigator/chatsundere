// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the bootstrap-admin CLI and post-redemption cleanup.
// Requires a live PostgreSQL instance and Redis. Skipped when DATABASE_URL is absent.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync, unlinkSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, pendingCodes, users } from '../../src/db/schema.js';
import { issueTokens } from '../../src/jwt/issue.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

const ORIGIN = { Origin: 'http://localhost:3000' };
const JSON_ORIGIN = { 'Content-Type': 'application/json', ...ORIGIN };

describe.skipIf(skip)('Bootstrap CLI', () => {
  let app: ReturnType<typeof createServer>;

  beforeAll(async () => {
    app = createServer();
    // Ensure the DB is clean: remove any existing primary_admin and auth_methods.
    const { db } = createDb();
    const primaryAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'primary_admin'));
    for (const { id } of primaryAdmins) {
      await db.delete(users).where(eq(users.id, id));
    }
    // Delete all auth_methods to make bootstrap eligible.
    await db.delete(authMethods);
    await db.delete(pendingCodes);
    await closeDb();
  });

  afterAll(async () => {
    const { db } = createDb();
    // Clean up: remove the primary_admin and any related data.
    const primaryAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'primary_admin'));
    for (const { id } of primaryAdmins) {
      await db.delete(users).where(eq(users.id, id));
    }
    await db.delete(authMethods);
    await db.delete(pendingCodes);
    await closeDb();
  });

  it('bootstrap CLI refuses when primary_admin already exists', async () => {
    const { db } = createDb();
    // Insert a primary_admin directly.
    await db.insert(users).values({
      username: 'existing-admin',
      role: 'primary_admin',
      recoveryVerifierKey: new Uint8Array(32),
    });

    // Try to run bootstrap — should refuse.
    const proc = Bun.spawn(['bun', 'run', 'src/cli/bootstrap.ts'], {
      cwd: '/home/chris/workspace/chatsundere/apps/auth-service',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await Bun.readableStreamToText(proc.stderr);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('primary_admin already exists');

    // Cleanup.
    await db.delete(users).where(eq(users.role, 'primary_admin'));
    await closeDb();
  });

  it('bootstrap CLI refuses when auth_methods is non-empty', async () => {
    const { db } = createDb();
    // Insert a user and an auth_method.
    const userRes = await db
      .insert(users)
      .values({
        username: `test-user-${Date.now()}`,
        role: 'user',
        recoveryVerifierKey: new Uint8Array(32),
      })
      .returning({ id: users.id });
    const userId = userRes[0]?.id;
    if (!userId) throw new Error('Failed to create test user');

    await db.insert(authMethods).values({
      userId,
      methodType: 'opaque',
      opaqueCredential: new Uint8Array(32),
      opaqueUserIdentifier: userId,
      wrappedMasterKey: new Uint8Array(32),
      wrapNonce: new Uint8Array(12),
      wrapAad: new Uint8Array(0),
    });

    // Try to run bootstrap — should refuse.
    const proc = Bun.spawn(['bun', 'run', 'src/cli/bootstrap.ts'], {
      cwd: '/home/chris/workspace/chatsundere/apps/auth-service',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    const stderr = await Bun.readableStreamToText(proc.stderr);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('auth_methods table is non-empty');

    // Cleanup.
    await db.delete(authMethods).where(eq(authMethods.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDb();
  });

  it('bootstrap CLI creates invitation and writes file with 0600 permissions', async () => {
    const proc = Bun.spawn(['bun', 'run', 'src/cli/bootstrap.ts'], {
      cwd: '/home/chris/workspace/chatsundere/apps/auth-service',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await Bun.readableStreamToText(proc.stdout);
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);

    const lines = stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const filePath = lines[0];
    if (!filePath) throw new Error('No file path in stdout');
    expect(filePath).toContain('chatsundere-bootstrap-');
    expect(filePath).toContain('.json');

    // Verify file exists and is readable.
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read bootstrap file at ${filePath}: ${err}`);
    }

    // Parse and verify structure. Per the unified-join shape (ADR 0028),
    // bootstrap writes a 10-char ambiguity-removed code plus a real
    // qr_url (https://host/join#CODE) — no more base64url-JSON payload.
    const data = JSON.parse(content);
    expect(data.code).toMatch(/^[23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5}$/);
    expect(data.qr_url).toContain('/join#');
    expect(data.invitation_id).toBeDefined();
    expect(data.expires_at_unix_ms).toBeDefined();

    // Verify file permissions are 0600 (read-write owner only).
    // File permissions check: mode should have 0o600.
    // Use stat -c %a to get permissions in octal.
    const statCmd = Bun.spawn(['stat', '-c', '%a', filePath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const modeOutput = await Bun.readableStreamToText(statCmd.stdout);
    const mode = modeOutput.trim();
    expect(mode).toBe('600');

    // Verify invitation exists in DB.
    const { db } = createDb();
    const invId = data.invitation_id;
    const inv = await db.select().from(pendingCodes).where(eq(pendingCodes.id, invId));
    expect(inv.length).toBe(1);
    expect(inv[0]?.role).toBe('primary_admin');
    expect(inv[0]?.issuerLabel).toBe('bootstrap');

    // Cleanup.
    try {
      unlinkSync(filePath);
    } catch {
      // Already deleted or doesn't exist.
    }
    await db.delete(pendingCodes).where(eq(pendingCodes.id, invId));
    await closeDb();
  });

  it('bootstrap file path follows naming convention', async () => {
    // Step 1: Run bootstrap to create the file and invitation.
    const proc = Bun.spawn(['bun', 'run', 'src/cli/bootstrap.ts'], {
      cwd: '/home/chris/workspace/chatsundere/apps/auth-service',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await Bun.readableStreamToText(proc.stdout);
    await proc.exited;

    const lines = stdout.trim().split('\n');
    const filePath = lines[0];
    if (!filePath) throw new Error('No file path in stdout');

    // Verify file exists.
    const contentRaw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(contentRaw);
    const invId = data.invitation_id;

    // Verify the file path matches the naming convention.
    expect(filePath).toContain(`chatsundere-bootstrap-${invId}.json`);

    // Cleanup the test.
    try {
      unlinkSync(filePath);
    } catch {
      // Already deleted.
    }
    const { db } = createDb();
    await db.delete(pendingCodes).where(eq(pendingCodes.id, invId));
    await closeDb();
  });
});
