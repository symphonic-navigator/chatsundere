// SPDX-License-Identifier: AGPL-3.0-only

/** The minimal Redis surface needed to publish a poke (satisfied by ioredis). */
export interface PublishRedis {
  publish(channel: string, message: string): Promise<number>;
}

/** The per-account doorbell channel. */
export const doorbellChannel = (accountId: string): string => `sync:${accountId}`;

/**
 * Publishes a contentless poke `{ rev, epoch }` to the account's doorbell
 * channel. Called once per accepted batch, strictly AFTER the transaction
 * commits (spec §8.2) — a pre-commit poke would race the subscriber's pull
 * against an invisible transaction.
 */
export async function publishPoke(
  redis: PublishRedis,
  accountId: string,
  rev: number,
  epoch: string,
): Promise<void> {
  await redis.publish(doorbellChannel(accountId), JSON.stringify({ rev, epoch }));
}
