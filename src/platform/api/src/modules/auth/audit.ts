import { randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';

export async function appendAuditEvent(
  database: Database,
  actorAccountId: string,
  action: string,
  targetType: string,
  targetId: string,
  reason?: string,
): Promise<void> {
  await database.query(
    'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason) VALUES ($1, $2, $3, $4, $5, $6)',
    [randomUUID(), actorAccountId, action, targetType, targetId, reason ?? null],
  );
}
