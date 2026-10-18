import { useCallback, useEffect, useState } from 'react';
import { getRuleSetDetail, listRounds, listRuleSets, listTeamsCount, type RoundSummary, type RuleSetSummary } from './api.ts';
import { selectCurrentLockedRound, sortRuleSetsNewestFirst } from './current-rule-set.ts';
import { RoundOperations } from './RoundOperations.tsx';
import { RoundRuleForm, type LockedRuleSetInfo } from './RoundRuleForm.tsx';
import { RuleSetArchive } from './RuleSetArchive.tsx';
import type { RoundRuleSetRulesV1 } from './rules-form.ts';

export function RoundAdminPage() {
  const [stage, setStage] = useState('QUALIFICATION');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<RoundRuleSetRulesV1 | null>(null);
  const [current, setCurrent] = useState<{ readonly info: LockedRuleSetInfo; readonly isLocked: boolean } | null>(null);
  const [ruleSets, setRuleSets] = useState<readonly RuleSetSummary[]>([]);
  const [rounds, setRounds] = useState<readonly RoundSummary[]>([]);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [fetchedRuleSets, fetchedRounds, count]: [readonly RuleSetSummary[], readonly RoundSummary[], number] = await Promise.all([
        listRuleSets(stage),
        listRounds(stage),
        listTeamsCount().catch(() => 0),
      ]);
      const latest = sortRuleSetsNewestFirst(fetchedRuleSets)[0] ?? null;
      const latestRules = latest ? (await getRuleSetDetail(latest.id).catch(() => null))?.rules ?? null : null;
      setPrefill(latestRules);
      setBaseVersion(null);
      setEditorKey((key) => key + 1);
      const lockedRound = selectCurrentLockedRound(fetchedRounds);
      const lockedSummary = lockedRound?.ruleSetId ? fetchedRuleSets.find((entry) => entry.id === lockedRound.ruleSetId) ?? null : null;
      const lockedDetail = lockedSummary ? await getRuleSetDetail(lockedSummary.id).catch(() => null) : null;
      if (lockedSummary && lockedDetail) {
        setCurrent({ info: { version: lockedSummary.version, rulesSha256: lockedSummary.rulesSha256, rules: lockedDetail.rules }, isLocked: true });
      } else if (latest && latestRules) {
        setCurrent({ info: { version: latest.version, rulesSha256: latest.rulesSha256, rules: latestRules }, isLocked: false });
      } else {
        setCurrent(null);
      }
      setRuleSets(fetchedRuleSets);
      setRounds(fetchedRounds);
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
          <div className="round-admin-grid">
            <section className="round-admin-current" aria-label="Bộ luật hiện hành">
              <details open>
                <summary><h2>Bộ luật hiện hành</h2></summary>
                {current !== null && !current.isLocked && <p>Chưa có bộ luật nào được khóa. Đang hiển thị phiên bản mới nhất (chỉ đọc).</p>}
                {current === null && <p>Chưa có bộ luật nào được khóa</p>}
                {current !== null && (
                  <div className="round-admin-current-scroll">
                    <RoundRuleForm
                      stage={stage}
                      prefill={null}
                      locked={current.info}
                      idPrefix="rrc"
                      initialTeamCount={teamCount}
                      notice={current.isLocked ? undefined : `Phiên bản ${current.info.version} (sha ${current.info.rulesSha256.slice(0, 8)}) chưa khóa vào round nào.`}
                      onSaved={() => {}}
                    />
                  </div>
                )}
              </details>
              <RuleSetArchive
                ruleSets={ruleSets}
                rounds={rounds}
                onUseAsBase={(version, rules) => {
                  setPrefill(rules);
                  setBaseVersion(version);
                  setEditorKey((key) => key + 1);
                }}
              />
            </section>
            <section className="round-admin-editor" aria-label="Phiên bản bộ luật mới">
              <h2>Phiên bản bộ luật mới</h2>
              {baseVersion !== null && <p role="status" className="round-base-note">Đang soạn dựa trên v{baseVersion}</p>}
              <div className="round-admin-editor-scroll">
              <RoundRuleForm
                key={`${stage}:${refreshToken}:${editorKey}`}
                stage={stage}
                prefill={prefill}
                locked={null}
                initialTeamCount={teamCount}
                onSaved={() => setRefreshToken((token) => token + 1)}
              />
              </div>
            </section>
          </div>
          <RoundOperations stage={stage} />
        </>
      )}
    </main>
  );
}
