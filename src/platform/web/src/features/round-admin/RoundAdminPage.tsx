import { useCallback, useEffect, useState } from 'react';
import { getRuleSetDetail, listRounds, listRuleSets, listTeamsCount, type RoundSummary, type RuleSetSummary } from './api.ts';
import { RoundOperations } from './RoundOperations.tsx';
import { RoundRuleForm, type LockedRuleSetInfo } from './RoundRuleForm.tsx';
import type { RoundRuleSetRulesV1 } from './rules-form.ts';

export function RoundAdminPage() {
  const [stage, setStage] = useState('QUALIFICATION');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<RoundRuleSetRulesV1 | null>(null);
  const [locked, setLocked] = useState<LockedRuleSetInfo | null>(null);
  const [teamCount, setTeamCount] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ruleSets, rounds, count]: [readonly RuleSetSummary[], readonly RoundSummary[], number] = await Promise.all([
        listRuleSets(stage),
        listRounds(stage),
        listTeamsCount().catch(() => 0),
      ]);
      const latest = ruleSets[0] ?? null;
      setPrefill(latest ? (await getRuleSetDetail(latest.id).catch(() => null))?.rules ?? null : null);
      const lockedRound = rounds.find((round) => round.ruleSetId !== null && round.status !== 'DRAFT_RULES') ?? null;
      if (lockedRound?.ruleSetId) {
        const summary = ruleSets.find((entry) => entry.id === lockedRound.ruleSetId) ?? null;
        const detail = await getRuleSetDetail(lockedRound.ruleSetId).catch(() => null);
        setLocked(detail && summary ? { version: summary.version, rulesSha256: summary.rulesSha256, rules: detail.rules } : null);
      } else {
        setLocked(null);
      }
      setTeamCount(count);
    } catch {
      setLoadError('Không thể tải dữ liệu round. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [stage, refreshToken]);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="admin-page">
      <p className="eyebrow">BTC · VẬN HÀNH ROUND</p>
      <h1>Vận hành round</h1>
      <p className="welcome-copy">
        Soạn bộ luật theo phiên bản, khóa bộ luật vào round và điều hành vòng đời round.
        Mọi thao tác đều cần lý do và được máy chủ kiểm tra trạng thái.
      </p>

      <div>
        <label htmlFor="round-admin-stage">Stage</label>
        <select id="round-admin-stage" value={stage} onChange={(event) => setStage(event.target.value)}>
          <option value="QUALIFICATION">QUALIFICATION</option>
        </select>
      </div>

      {loadError !== null && <div role="alert"><p>{loadError}</p><button type="button" onClick={() => void load()}>Thử lại</button></div>}
      {loading && <p role="status" aria-busy="true">Đang tải dữ liệu round…</p>}

      {!loading && loadError === null && (
        <>
          {locked !== null && (
            <section aria-label="Bộ luật đang khóa">
              <h2>Bộ luật đang khóa</h2>
              <RoundRuleForm stage={stage} prefill={null} locked={locked} initialTeamCount={teamCount} onSaved={() => {}} />
            </section>
          )}
          <section aria-label="Soạn phiên bản bộ luật mới">
            <h2>Phiên bản bộ luật mới</h2>
            <RoundRuleForm
              key={`${stage}:${refreshToken}`}
              stage={stage}
              prefill={prefill}
              locked={null}
              initialTeamCount={teamCount}
              onSaved={() => setRefreshToken((token) => token + 1)}
            />
          </section>
          <RoundOperations stage={stage} />
        </>
      )}
    </main>
  );
}
