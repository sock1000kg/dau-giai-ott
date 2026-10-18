import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { calculateEloDelta } from '../src/modules/ratings/elo.ts';
import { registerLeaderboardRoutes } from '../src/modules/ratings/routes.ts';
import { applyRoundRatings, rebuildRatingLedger } from '../src/modules/ratings/service.ts';
import { recordGateResult } from '../src/modules/qualification-gate/service.ts';
import { isSubmissionRankable } from '../src/modules/scheduling/eligibility.ts';
import { scheduleRound } from '../src/modules/scheduling/service.ts';
import Fastify from 'fastify';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

const tag = () => randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

integration('P3-L03 qualification gate, adaptive K and eligibility (PostgreSQL)', () => {
  let database: Database;
  const teamIds: string[] = [];
  const submissionIds: string[] = [];
  const seriesIds: string[] = [];
  const matchIds: string[] = [];
  const roundIds: string[] = [];
  const adminId = randomUUID();
  const run = tag();
  let teamCounter = 0;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    await database.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1,$2,'unused','BTC_ADMIN')", [adminId, `l03-${run.toLowerCase()}`]);
  });

  afterAll(async () => {
    if (database === undefined) return;
    await database.query('ALTER TABLE submission_gate_results DISABLE TRIGGER submission_gate_results_append_only');
    await database.query('DELETE FROM submission_gate_results WHERE submission_id = ANY($1::uuid[])', [submissionIds]);
    await database.query('ALTER TABLE submission_gate_results ENABLE TRIGGER submission_gate_results_append_only');
    await database.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await database.query('DELETE FROM audit_events WHERE actor_account_id = $1', [adminId]);
    await database.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
    await database.query('DELETE FROM match_outbox WHERE match_id = ANY($1::uuid[])', [matchIds]);
    await database.query('DELETE FROM match_results WHERE match_id = ANY($1::uuid[])', [matchIds]);
    await database.query('DELETE FROM rating_ledger WHERE series_id = ANY($1::uuid[])', [seriesIds]);
    await database.query('DELETE FROM matches WHERE id = ANY($1::uuid[])', [matchIds]);
    await database.query('DELETE FROM round_participants WHERE round_id = ANY($1::uuid[])', [roundIds]);
    await database.query('DELETE FROM series WHERE id = ANY($1::uuid[])', [seriesIds]);
    await database.query('DELETE FROM rounds WHERE id = ANY($1::uuid[])', [roundIds]);
    await database.query('DELETE FROM submissions WHERE id = ANY($1::uuid[])', [submissionIds]);
    await database.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
    await database.query('DELETE FROM accounts WHERE id = $1', [adminId]);
    await database.close();
  });

  async function team(stage: string, name: string, manifestSeed = '1') {
    const teamId = randomUUID();
    const submissionId = randomUUID();
    teamIds.push(teamId);
    submissionIds.push(submissionId);
    await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `${name} ${run} ${++teamCounter}`]);
    await database.query(
      "INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, policy_version, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'P2_BASELINE_V1','ACTIVE')",
      [submissionId, teamId, stage, digest('a'), digest(manifestSeed), digest('c'), `l03/${submissionId}`],
    );
    return { teamId, submissionId };
  }

  // -------------------------------------------------------------- gate persistence
  describe('gate results', () => {
    const stage = `L03G_${run}`;
    const ctx = { actorAccountId: adminId, correlationId: randomUUID(), reason: 'gate run' };
    const gateDigest = digest('9');
    let candidate: { teamId: string; submissionId: string };
    let gate: { teamId: string; submissionId: string };
    const gamesInSeries = new Map<string, number>();

    async function game(options: { submissionSide: 'X' | 'O'; winner: 'X' | 'O' | null; status?: string; withResult?: boolean; seriesId?: string; x?: string; o?: string }) {
      const seriesId = options.seriesId ?? randomUUID();
      // game_number is derived per series (UNIQUE(series_id, game_number)): the first game is 1, the next 2
      const gameNumber = (gamesInSeries.get(seriesId) ?? 0) + 1;
      gamesInSeries.set(seriesId, gameNumber);
      if (options.seriesId === undefined) {
        seriesIds.push(seriesId);
        await database.query("INSERT INTO series (id, tournament_stage, status) VALUES ($1,$2,'SCHEDULED')", [seriesId, stage]);
      }
      const matchId = randomUUID();
      matchIds.push(matchId);
      const x = options.x ?? (options.submissionSide === 'X' ? candidate.submissionId : gate.submissionId);
      const o = options.o ?? (options.submissionSide === 'X' ? gate.submissionId : candidate.submissionId);
      await database.query(
        "INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, game_number) VALUES ($1,$2,$3,$4,$5,$6)",
        [matchId, seriesId, x, o, options.status ?? 'FINALIZED', gameNumber],
      );
      if (options.withResult !== false && (options.status ?? 'FINALIZED') === 'FINALIZED') {
        await database.query('INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash) VALUES ($1,$2,$3,1,$4)',
          [matchId, options.winner, 'TURN_LIMIT', 'f'.repeat(64)]);
      }
      return { matchId, seriesId };
    }

    async function freshCandidate() {
      candidate = await team(stage, 'candidate');
    }

    beforeAll(async () => {
      gate = await team(stage, 'capture_first_bot', '9');
    });

    it('persists PASS for win + loss, idempotently, and exposes rankability', async () => {
      await freshCandidate();
      const g1 = await game({ submissionSide: 'X', winner: 'X' });
      const g2 = await game({ submissionSide: 'O', winner: 'X', seriesId: g1.seriesId });
      const input = { submissionId: candidate.submissionId, gateBotId: 'capture_first_bot', gateBotDigest: gateDigest, game1MatchId: g1.matchId, game2MatchId: g2.matchId };
      expect(await isSubmissionRankable(database, candidate.submissionId)).toBe(false);
      const first = await recordGateResult(database, ctx, input);
      expect(first.replayed).toBe(false);
      expect(first.result).toMatchObject({ game1Points: 1, game2Points: 0, points: 1, outcome: 'PASS' });
      const replay = await recordGateResult(database, ctx, input);
      expect(replay).toMatchObject({ replayed: true, result: { id: first.result.id } });
      const rows = await database.query('SELECT 1 FROM submission_gate_results WHERE submission_id = $1', [candidate.submissionId]);
      expect(rows.rows).toHaveLength(1);
      const audits = await database.query("SELECT 1 FROM audit_events WHERE target_id = $1 AND action = 'qualification_gate.record'", [candidate.submissionId]);
      expect(audits.rows).toHaveLength(1);
      expect(await isSubmissionRankable(database, candidate.submissionId)).toBe(true);
    });

    it('409s a replay with different matches and rejects mutation of stored rows', async () => {
      await freshCandidate();
      const g1 = await game({ submissionSide: 'X', winner: 'O' });
      const g2 = await game({ submissionSide: 'O', winner: 'O', seriesId: g1.seriesId });
      const input = { submissionId: candidate.submissionId, gateBotId: 'capture_first_bot', gateBotDigest: gateDigest, game1MatchId: g1.matchId, game2MatchId: g2.matchId };
      const stored = await recordGateResult(database, ctx, input);
      expect(stored.result).toMatchObject({ points: 1, outcome: 'PASS' }); // loss + win
      const other = await game({ submissionSide: 'O', winner: 'X' });
      await expect(recordGateResult(database, ctx, { ...input, game2MatchId: other.matchId })).rejects.toMatchObject({ code: 'GATE_RESULT_CONFLICT', statusCode: 409 });
      await expect(database.query("UPDATE submission_gate_results SET outcome = 'FAIL', points = 0, game1_points = 0, game2_points = 0 WHERE id = $1", [stored.result.id])).rejects.toThrow(/append-only/);
      await expect(database.query('DELETE FROM submission_gate_results WHERE id = $1', [stored.result.id])).rejects.toThrow(/append-only/);
      await expect(database.query(
        `INSERT INTO submission_gate_results (id, submission_id, gate_bot_id, gate_bot_digest, game1_points, game2_points, points, outcome, reason)
         VALUES ($1,$2,'other_bot',$3,0,0,0,'PASS','inconsistent')`, [randomUUID(), candidate.submissionId, gateDigest],
      )).rejects.toThrow();
    });

    it('records FAIL for loss + loss', async () => {
      await freshCandidate();
      const g1 = await game({ submissionSide: 'X', winner: 'O' });
      const g2 = await game({ submissionSide: 'O', winner: 'X', seriesId: g1.seriesId });
      const { result } = await recordGateResult(database, ctx, { submissionId: candidate.submissionId, gateBotId: 'capture_first_bot', gateBotDigest: gateDigest, game1MatchId: g1.matchId, game2MatchId: g2.matchId });
      expect(result).toMatchObject({ points: 0, outcome: 'FAIL' });
      expect(await isSubmissionRankable(database, candidate.submissionId)).toBe(false);
    });

    it('rejects non-finalized, foreign and same-side games without writing', async () => {
      await freshCandidate();
      const ok = await game({ submissionSide: 'O', winner: 'O' });
      const base = { submissionId: candidate.submissionId, gateBotId: 'capture_first_bot', gateBotDigest: gateDigest };
      const running = await game({ submissionSide: 'X', winner: null, status: 'RUNNING', seriesId: ok.seriesId });
      await expect(recordGateResult(database, ctx, { ...base, game1MatchId: running.matchId, game2MatchId: ok.matchId })).rejects.toMatchObject({ code: 'GATE_PENDING' });
      const failed = await game({ submissionSide: 'X', winner: null, status: 'FAILED' });
      await expect(recordGateResult(database, ctx, { ...base, game1MatchId: failed.matchId, game2MatchId: ok.matchId })).rejects.toMatchObject({ code: 'GATE_PENDING' });
      const sameSide = await game({ submissionSide: 'O', winner: 'O' });
      await expect(recordGateResult(database, ctx, { ...base, game1MatchId: sameSide.matchId, game2MatchId: ok.matchId })).rejects.toMatchObject({ code: 'GATE_SIDES_NOT_SWAPPED' });
      const stranger = await team(stage, 'stranger');
      const foreign = await game({ submissionSide: 'X', winner: 'X', x: stranger.submissionId, o: gate.submissionId });
      await expect(recordGateResult(database, ctx, { ...base, game1MatchId: foreign.matchId, game2MatchId: ok.matchId })).rejects.toMatchObject({ code: 'GATE_MATCH_FOREIGN' });
      const wrongBot = await game({ submissionSide: 'X', winner: 'X', o: stranger.submissionId });
      await expect(recordGateResult(database, ctx, { ...base, game1MatchId: wrongBot.matchId, game2MatchId: ok.matchId })).rejects.toMatchObject({ code: 'GATE_MATCH_FOREIGN' });
      const rows = await database.query('SELECT 1 FROM submission_gate_results WHERE submission_id = $1', [candidate.submissionId]);
      expect(rows.rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------- adaptive K via the real ledger code
  describe('adaptive K and rebuild', () => {
    async function playRounds(stage: string, count: number, policy: string | null) {
      const a = await team(stage, 'k-a');
      const b = await team(stage, 'k-b');
      let ratingA = 1000;
      let ratingB = 1000;
      const out: { seriesId: string; roundId: string }[] = [];
      for (let index = 0; index < count; index += 1) {
        const roundId = randomUUID();
        const seriesId = randomUUID();
        roundIds.push(roundId);
        seriesIds.push(seriesId);
        await database.query(
          `INSERT INTO rounds (id, tournament_stage, idempotency_key, request_hash, schedule_seed, status, rating_snapshot, finalized_at, created_at ${policy === null ? '' : ', rating_policy_version'})
           VALUES ($1,$2,$3,$4,$5,'FINALIZED',$6::jsonb, now() + ($7::integer * interval '1 minute'), now() - ($7::integer * interval '1 minute') ${policy === null ? '' : ',$8'})`,
          [roundId, stage, `k-${index}`, String(index % 10).repeat(64), `seed-${index}`,
            JSON.stringify([{ teamId: a.teamId, rating: ratingA }, { teamId: b.teamId, rating: ratingB }]), index, ...(policy === null ? [] : [policy])],
        );
        await database.query("INSERT INTO series (id, tournament_stage, status, round_id, team_a_id, team_b_id, team_a_score, team_b_score, finalized_at) VALUES ($1,$2,'FINALIZED',$3,$4,$5,2,0,now())",
          [seriesId, stage, roundId, a.teamId, b.teamId]);
        await applyRoundRatings(database, roundId);
        const ledger = await database.query<{ team_id: string; rating_after: number }>('SELECT team_id, rating_after FROM rating_ledger WHERE series_id = $1', [seriesId]);
        ratingA = ledger.rows.find(({ team_id }) => team_id === a.teamId)!.rating_after;
        ratingB = ledger.rows.find(({ team_id }) => team_id === b.teamId)!.rating_after;
        out.push({ seriesId, roundId });
      }
      return { a, b, out };
    }

    const snapshotLedger = async (ids: readonly string[]) => (await database.query(
      'SELECT team_id, series_id, rating_before, rating_after, delta FROM rating_ledger WHERE series_id = ANY($1::uuid[]) ORDER BY series_id, team_id', [ids],
    )).rows;

    it('uses K=64 through the fifth series, K=32 from the sixth, and rebuild equals incremental', async () => {
      const stage = `L03K_${run}`;
      const { a, out } = await playRounds(stage, 7, 'elo-adaptive-k-v1');
      const ids = out.map(({ seriesId }) => seriesId);
      // precondition for rebuild == incremental and for mutation 3: history order (finalized_at, id) must differ from creation order
      const timeline = await database.query<{ id: string }>('SELECT id FROM rounds WHERE tournament_stage = $1 ORDER BY finalized_at, id', [stage]);
      const createdOrder = await database.query<{ id: string }>('SELECT id FROM rounds WHERE tournament_stage = $1 ORDER BY created_at, id', [stage]);
      const finalizedOrder = timeline.rows.map(({ id }) => id);
      expect(finalizedOrder).toEqual(out.map(({ roundId }) => roundId));
      expect(finalizedOrder).not.toEqual(createdOrder.rows.map(({ id }) => id));
      const before = await snapshotLedger(ids);
      const rowsA = await database.query<{ rating_before: number; delta: number; series_id: string }>(
        'SELECT rating_before, delta, series_id FROM rating_ledger WHERE team_id = $1', [a.teamId]);
      const byRound = out.map(({ seriesId }) => rowsA.rows.find((row) => row.series_id === seriesId)!);
      const opponent = await database.query<{ rating_before: number; series_id: string }>('SELECT rating_before, series_id FROM rating_ledger WHERE team_id <> $1 AND series_id = ANY($2::uuid[])', [a.teamId, ids]);
      for (const [index, row] of byRound.entries()) {
        const opponentBefore = opponent.rows.find(({ series_id }) => series_id === row.series_id)!.rating_before;
        expect(row.delta, `series ${index + 1}`).toBe(calculateEloDelta(row.rating_before, opponentBefore, 1, index < 5 ? 64 : 32));
      }
      await database.query('DELETE FROM rating_ledger WHERE series_id = ANY($1::uuid[])', [ids]);
      await database.query('UPDATE rounds SET rating_applied_at = NULL WHERE tournament_stage = $1', [stage]);
      const rebuilt = await rebuildRatingLedger(database, stage);
      expect(rebuilt.inserted).toBe(before.length);
      expect(await snapshotLedger(ids)).toEqual(before);
      expect((await rebuildRatingLedger(database, stage)).inserted).toBe(0);
    });

    it('keeps K=32 for rounds created under the legacy policy default', async () => {
      const stage = `L03L_${run}`;
      const { a, out } = await playRounds(stage, 2, null);
      const first = await database.query<{ delta: number }>('SELECT delta FROM rating_ledger WHERE team_id = $1 AND series_id = $2', [a.teamId, out[0]!.seriesId]);
      expect(first.rows[0]?.delta).toBe(16);
      const pinned = await database.query<{ rating_policy_version: string }>('SELECT rating_policy_version FROM rounds WHERE id = $1', [out[0]!.roundId]);
      expect(pinned.rows[0]?.rating_policy_version).toBe('elo-k32-v1');
      await expect(database.query("UPDATE rounds SET rating_policy_version = 'elo-adaptive-k-v1' WHERE id = $1", [out[0]!.roundId])).rejects.toThrow(/immutable/);
    });

    it('scheduleRound pins the adaptive policy on new rounds', async () => {
      const stage = `L03S_${run}`;
      await team(stage, 's-a');
      await team(stage, 's-b');
      const scheduled = await scheduleRound(database, { tournamentStage: stage, idempotencyKey: 'l03-policy' });
      roundIds.push(scheduled.roundId);
      seriesIds.push(...scheduled.seriesIds);
      matchIds.push(...scheduled.matchIds);
      const pinned = await database.query<{ rating_policy_version: string }>('SELECT rating_policy_version FROM rounds WHERE id = $1', [scheduled.roundId]);
      expect(pinned.rows[0]?.rating_policy_version).toBe('elo-adaptive-k-v1');
    });
  });

  // -------------------------------------------------------------- pool filter
  describe('pool filter', () => {
    afterAll(() => { delete process.env.OTT_QUALIFICATION_GATE_ENFORCED; });

    it('excludes teams without a PASS only when enforcement is on', async () => {
      const stage = `L03P_${run}`;
      const passing = await team(stage, 'p-pass');
      const failing = await team(stage, 'p-fail');
      const gateStage = `L03PG_${run}`;
      const gateBot = await team(gateStage, 'p-bot', '8');
      const botDigest = digest('8');
      // a PASS row for the first team only, with matches pointing at the gate bot
      const seriesId = randomUUID();
      seriesIds.push(seriesId);
      await database.query("INSERT INTO series (id, tournament_stage, status) VALUES ($1,$2,'SCHEDULED')", [seriesId, gateStage]);
      const ids: string[] = [];
      for (const [number, side] of [[1, 'X'], [2, 'O']] as const) {
        const matchId = randomUUID();
        matchIds.push(matchId);
        ids.push(matchId);
        await database.query("INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, game_number) VALUES ($1,$2,$3,$4,'FINALIZED',$5)",
          [matchId, seriesId, side === 'X' ? passing.submissionId : gateBot.submissionId, side === 'X' ? gateBot.submissionId : passing.submissionId, number]);
        await database.query("INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash) VALUES ($1,$2,'TURN_LIMIT',1,$3)", [matchId, 'X', 'e'.repeat(64)]);
      }
      await recordGateResult(database, { actorAccountId: adminId, correlationId: randomUUID(), reason: 'pool' }, {
        submissionId: passing.submissionId, gateBotId: 'capture_first_bot', gateBotDigest: botDigest, game1MatchId: ids[0]!, game2MatchId: ids[1]!,
      });
      expect(await isSubmissionRankable(database, passing.submissionId)).toBe(true);
      expect(await isSubmissionRankable(database, failing.submissionId)).toBe(false);

      // enforcement off (default): both teams are paired
      delete process.env.OTT_QUALIFICATION_GATE_ENFORCED;
      const off = await scheduleRound(database, { tournamentStage: stage, idempotencyKey: 'pool-off' });
      roundIds.push(off.roundId); seriesIds.push(...off.seriesIds); matchIds.push(...off.matchIds);
      expect(off.seriesIds).toHaveLength(1);
      // enforcement on: only one team left in the pool, so scheduling needs at least two
      await database.query("UPDATE series SET status = 'CANCELLED', cancellation_reason = 'MATCH_CANCELLED', finalized_at = now() WHERE round_id = $1", [off.roundId]);
      await database.query("UPDATE rounds SET status = 'FINALIZED', finalized_at = now() WHERE id = $1", [off.roundId]);
      process.env.OTT_QUALIFICATION_GATE_ENFORCED = 'true';
      await expect(scheduleRound(database, { tournamentStage: stage, idempotencyKey: 'pool-on' })).rejects.toThrow('SCHEDULING_INSUFFICIENT_TEAMS');
    });
  });

  // -------------------------------------------------------------- leaderboard labels
  describe('leaderboard labels', () => {
    it('labels a team with 4 finalized series unranked and a team with 5 ranked', async () => {
      const stage = `L03B_${run}`;
      const heavy = await team(stage, 'lb-five');
      const light = await team(stage, 'lb-four');
      const fillers: { teamId: string }[] = [];
      for (let index = 0; index < 5; index += 1) fillers.push(await team(stage, `lb-f${index}`));
      for (let index = 0; index < 5; index += 1) {
        const roundId = randomUUID();
        const seriesId = randomUUID();
        roundIds.push(roundId); seriesIds.push(seriesId);
        await database.query("INSERT INTO rounds (id, tournament_stage, idempotency_key, request_hash, schedule_seed, status, rating_snapshot, finalized_at) VALUES ($1,$2,$3,$4,$5,'FINALIZED','[]'::jsonb,now())",
          [roundId, stage, `lb-${index}`, String(index).repeat(64), `lb-${index}`]);
        const opponent = index < 4 ? light.teamId : fillers[index]!.teamId;
        await database.query("INSERT INTO series (id, tournament_stage, status, round_id, team_a_id, team_b_id, team_a_score, team_b_score, finalized_at) VALUES ($1,$2,'FINALIZED',$3,$4,$5,1,1,now())",
          [seriesId, stage, roundId, heavy.teamId, opponent]);
        await database.query("INSERT INTO round_participants (round_id, series_id, team_id, assignment, series_slot) VALUES ($1,$2,$3,'PAIRED','A'),($1,$2,$4,'PAIRED','B')",
          [roundId, seriesId, heavy.teamId, opponent]);
      }
      const app = Fastify({ logger: false });
      registerLeaderboardRoutes(app, { database });
      const response = await app.inject({ method: 'GET', url: `/api/v1/leaderboard?stage=${stage}&pageSize=100` });
      expect(response.statusCode).toBe(200);
      const items = response.json().data.items as { team: { id: string }; ratedSeries: number; ratingStatus: string; finalsEligible: boolean }[];
      expect(items.find(({ team }) => team.id === heavy.teamId)).toMatchObject({ ratedSeries: 5, ratingStatus: 'RANKED', finalsEligible: true });
      expect(items.find(({ team }) => team.id === light.teamId)).toMatchObject({ ratedSeries: 4, ratingStatus: 'UNRANKED_MIN_SERIES', finalsEligible: false });
      const lowered = await app.inject({ method: 'GET', url: `/api/v1/leaderboard?stage=${stage}&pageSize=100&minimumSeries=4` });
      expect((lowered.json().data.items as { team: { id: string }; ratingStatus: string }[]).find(({ team }) => team.id === light.teamId)?.ratingStatus).toBe('RANKED');
      await app.close();
    });
  });
});
