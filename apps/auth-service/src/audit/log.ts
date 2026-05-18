// SPDX-License-Identifier: AGPL-3.0-only

import { parse } from 'valibot';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { AUDIT_EVENT_SCHEMAS, type AuditEventType } from './events.js';

const MAX_METADATA_BYTES = 2048;

export interface WriteAuditArgs {
  db: Db;
  eventType: AuditEventType;
  userId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(args: WriteAuditArgs): Promise<void> {
  const schema = AUDIT_EVENT_SCHEMAS[args.eventType];
  const metadata = args.metadata ?? {};
  parse(schema, metadata);
  const json = JSON.stringify(metadata);
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error(
      `audit metadata exceeds ${MAX_METADATA_BYTES} bytes for event ${args.eventType}`,
    );
  }
  await args.db.insert(auditLog).values({
    userId: args.userId ?? null,
    actorUserId: args.actorUserId ?? null,
    eventType: args.eventType,
    metadata,
  });
}
