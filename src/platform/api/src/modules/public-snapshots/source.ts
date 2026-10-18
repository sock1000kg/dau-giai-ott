import type { Database } from '../../db/client.ts';
import { leaderboardSql, type LeaderboardRow } from '../ratings/routes.ts';
import { computeRulesSha256, validateRoundRuleSetRules, type RoundRuleSetRulesV1 } from '../rounds/types.ts';
import { finalsEligibility } from '../scheduling/eligibility.ts';
import { publishPublicSnapshot, type PublicSnapshot } from './publisher.ts';

export interface PublicEditorial {
  announcements: PublicSnapshot['announcements'];
  faq: PublicSnapshot['faq'];
  status: PublicSnapshot['status'];
  changelog: string;
  minimumSeries: number;
}

/** Trusted background producer: never runs as part of a spectator request. */
export async function collectQualificationSnapshot(database: Database, editorial: PublicEditorial,
  queueMatchIds: readonly string[], now = new Date()): Promise<PublicSnapshot> {
  return database.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const selected = await tx.query<{
      round_number: number; status: string; schedule_round_id: string | null;
      version: number; rules: RoundRuleSetRulesV1; rules_sha256: string;
    }>(`SELECT q.round_number, q.status, q.schedule_round_id, r.version, r.rules, r.rules_sha256
      FROM qualification_rounds q JOIN round_rule_sets r ON r.id = q.rule_set_id
      WHERE q.tournament_stage = 'QUALIFICATION' AND q.status <> 'DRAFT_RULES'
      ORDER BY q.round_number DESC LIMIT 1`);
    const round = selected.rows[0];
    if (!round || validateRoundRuleSetRules(round.rules).errors.length
      || computeRulesSha256(round.rules) !== round.rules_sha256) throw new Error('No valid announced qualification rules');
    const matches = await tx.query<{ id: string; teams: string; status: string; winner_side: string | null; map_definition: unknown }>(`
      SELECT m.id, x.name || ' / ' || o.name AS teams, m.status, result.winner_side, m.map_definition
      FROM matches m JOIN series s ON s.id = m.series_id
      JOIN submissions sx ON sx.id = m.x_submission_id JOIN teams x ON x.id = sx.team_id
      JOIN submissions so ON so.id = m.o_submission_id JOIN teams o ON o.id = so.team_id
      LEFT JOIN match_results result ON result.match_id = m.id
      WHERE s.round_id = $1 ORDER BY m.created_at, m.id`, [round.schedule_round_id]);
    const ranked = await tx.query<LeaderboardRow>(leaderboardSql, ['QUALIFICATION', null, 0]);
    const pending = new Map(matches.rows.filter((m) => m.status === 'SCHEDULED' || m.status === 'RUNNING').map((m) => [m.id, m]));
    const rules = round.rules;
    return {
      schemaVersion: 1, updatedAt: now.toISOString(), stage: 'QUALIFICATION',
      round: { name: `Round ${round.round_number}`, status: round.status },
      queue: [...new Set(queueMatchIds)].flatMap((id) => {
        const row = pending.get(id); return row ? [{ position: 0, teams: row.teams, etaSeconds: null }] : [];
      }).map((row, index) => ({ ...row, position: index + 1 })),
      results: matches.rows.filter((m) => m.status === 'FINALIZED').map((m) => ({
        matchId: m.id, teams: m.teams, score: m.winner_side === 'X' ? '1–0' : m.winner_side === 'O' ? '0–1' : '½–½',
        syncVerified: false, replayPublished: false,
      })),
      leaderboard: ranked.rows.map((row) => ({ rank: Number(row.rank), team: row.team_name, rating: row.rating,
        eligible: finalsEligibility({ ratedSeries: row.series_wins + row.series_draws + row.series_losses,
          minimumSeries: editorial.minimumSeries }).eligible })),
      rules: { version: `${round.version} · sha256:${round.rules_sha256}`, engineVersion: rules.engineVersion, sections: [
        { title: 'Map set', body: JSON.stringify(rules.mapSet) },
        { title: 'Bàn cờ đã khóa', body: JSON.stringify([...new Map(matches.rows.map((m) => [JSON.stringify(m.map_definition), m.map_definition])).values()]) },
        { title: 'Thay đổi', body: editorial.changelog },
        { title: 'Time control', body: JSON.stringify(rules.timeControl) },
        { title: 'maxTurns / fault policy', body: `${rules.maxTurns} / ${rules.faultPolicyVersion}` },
        { title: 'Sandbox limits', body: JSON.stringify(rules.resources) },
      ] },
      schedule: Object.entries(rules.schedule).map(([title, value]) => ({ title, body: String(value) })),
      announcements: editorial.announcements, faq: editorial.faq, status: editorial.status,
    };
  });
}

export async function publishQualificationSnapshot(database: Database, directory: string, editorial: PublicEditorial,
  queueMatchIds: readonly string[], now = new Date()) {
  return publishPublicSnapshot(directory, await collectQualificationSnapshot(database, editorial, queueMatchIds, now));
}
