// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { buildJoinQrUrl } from '../codes/qr-url.js';
import { generateCode, hashCode } from '../codes/token.js';
import { closeDb, createDb } from '../db/client.js';
import { authMethods, pendingCodes, users } from '../db/schema.js';
import { loadEnv } from '../env.js';

export async function main(): Promise<void> {
  const { db } = createDb();
  // Refuse if any primary_admin already exists OR if any auth_methods row exists.
  const primaryCount = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.role, 'primary_admin'));
  if ((primaryCount[0]?.value ?? 0) > 0) {
    console.error('bootstrap-admin: primary_admin already exists; refusing to run');
    process.exit(1);
  }
  const methodsCount = await db.select({ value: count() }).from(authMethods);
  if ((methodsCount[0]?.value ?? 0) > 0) {
    console.error('bootstrap-admin: auth_methods table is non-empty; refusing to run');
    process.exit(1);
  }

  const env = loadEnv();
  const code = generateCode();
  const codeHmac = await hashCode(code);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const inserted = await db
    .insert(pendingCodes)
    .values({
      type: 'invitation',
      codeHmac,
      role: 'primary_admin',
      issuerLabel: 'bootstrap',
      createdBy: null,
      expiresAt,
    })
    .returning({ id: pendingCodes.id });
  const invitationId = inserted[0]?.id;
  if (!invitationId) throw new Error('Failed to insert invitation');

  const qrUrl = buildJoinQrUrl(env, code);

  const dir = process.env.XDG_RUNTIME_DIR ?? '/tmp';
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `chatsundere-bootstrap-${invitationId}.json`);
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        code,
        qr_url: qrUrl,
        invitation_id: invitationId,
        expires_at_unix_ms: expiresAt.getTime(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  console.log(filePath);
  console.log(
    'Open this file from the user-client; the file will be removed automatically after the bootstrap invitation is redeemed.',
  );

  await closeDb();
}

if (import.meta.main) {
  await main();
}
