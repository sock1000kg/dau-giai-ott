import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.ts';
import { findMap } from './catalog.ts';
import { computeRulesSha256, validateRoundRuleSetRules, type RoundRuleSetRulesV1 } from './types.ts';

export interface PublicMapRoutesOptions {
  readonly database: Database;
}

export function registerPublicMapRoutes(app: FastifyInstance, options: PublicMapRoutesOptions): void {
  app.get('/api/v1/public/rounds/current/maps', async (_request: FastifyRequest, reply: FastifyReply) => {
    const selected = await options.database.query<{
      round_number: number;
      status: string;
      rules: RoundRuleSetRulesV1;
      rules_sha256: string;
    }>(`SELECT q.round_number, q.status, r.rules, r.rules_sha256
        FROM qualification_rounds q
        JOIN round_rule_sets r ON r.id = q.rule_set_id
        WHERE q.tournament_stage = 'QUALIFICATION' AND q.status <> 'DRAFT_RULES'
        ORDER BY q.round_number DESC LIMIT 1`);
    const round = selected.rows[0];
    if (!round) {
      return reply.status(404).send({ error: { code: 'NO_PUBLISHED_ROUND', message: 'No published round' } });
    }
    const { errors } = validateRoundRuleSetRules(round.rules);
    if (errors.length > 0) {
      return reply.status(404).send({ error: { code: 'NO_PUBLISHED_ROUND', message: 'No published round' } });
    }
    if (computeRulesSha256(round.rules) !== round.rules_sha256) {
      return reply.status(404).send({ error: { code: 'NO_PUBLISHED_ROUND', message: 'No published round' } });
    }

    const maps = round.rules.mapSet.map((entry) => {
      const registered = findMap(entry.mapId, entry.checksum);
      return {
        mapId: entry.mapId,
        version: registered?.version ?? 1,
        checksum: entry.checksum,
        definition: registered?.definition,
      };
    });

    return reply.status(200).send({
      round: {
        name: `Round ${round.round_number}`,
        status: round.status,
      },
      maps,
    });
  });

  app.get<{ Params: { mapId: string }; Querystring: { checksum?: string } }>(
    '/api/v1/public/maps/:mapId',
    async (request, reply) => {
      const { mapId } = request.params;
      const { checksum } = request.query;

      if (!checksum || typeof checksum !== 'string' || !/^[0-9a-f]{64}$/i.test(checksum)) {
        return reply.status(404).send({ error: { code: 'MAP_NOT_FOUND', message: 'Map not found' } });
      }

      const registered = findMap(mapId, checksum);
      if (!registered) {
        return reply.status(404).send({ error: { code: 'MAP_NOT_FOUND', message: 'Map not found' } });
      }

      const first8 = checksum.slice(0, 8);
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${mapId}-${first8}.json"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'public, max-age=300')
        .send(registered.definition);
    },
  );
}
