import { useState } from 'react';
import { getRuleSetDetail, type RoundSummary, type RuleSetDetail, type RuleSetSummary } from './api.ts';
import { roundsUsingRuleSet, sortRuleSetsNewestFirst } from './current-rule-set.ts';
import { isoToVn, type RoundRuleSetRulesV1 } from './rules-form.ts';

function formatCreatedAt(iso: string): string {
  return (isoToVn(iso) ?? iso).replace('T', ' ');
}

function perTurnText(rules: RoundRuleSetRulesV1): string {
  const perTurn = rules.timeControl.perTurn;
  return perTurn.mode === 'FIXED'
    ? `Cố định ${perTurn.fixedMs} ms`
    : `Dynamic ${perTurn.baseMs} ms + ${perTurn.stepMs} ms mỗi ${perTurn.everyTurns} lượt, tối đa ${perTurn.maxMs} ms`;
}

function RuleSetReadOnly({ detail }: Readonly<{ detail: RuleSetDetail }>) {
  const { rules } = detail;
  return (
    <div className="rule-set-detail">
      <h3>Phiên bản v{detail.version}</h3>
      <dl>
        <div><dt>Engine</dt><dd>{rules.engineVersion}</dd></div>
        <div><dt>Số lượt tối đa</dt><dd>{rules.maxTurns}</dd></div>
        <div><dt>Fault policy</dt><dd>{rules.faultPolicyVersion}</dd></div>
        <div><dt>Startup</dt><dd>{rules.timeControl.startupMs} ms</dd></div>
        <div><dt>Tổng thời gian/bot/trận</dt><dd>{rules.timeControl.totalBotBudgetMs} ms</dd></div>
        <div><dt>Wall-clock/trận</dt><dd>{rules.timeControl.matchWallClockMs} ms</dd></div>
        <div><dt>Mỗi lượt</dt><dd>{perTurnText(rules)}</dd></div>
        <div><dt>Tài nguyên</dt><dd>{rules.resources.memoryMiB} MiB RAM · {rules.resources.milliCpu} milliCPU · {rules.resources.pids} PID</dd></div>
        <div><dt>Quota test run</dt><dd>{rules.testRun.quotaPerTeamPerDay}/đội/ngày</dd></div>
        <div><dt>Khung chạy tối đa</dt><dd>{rules.schedule.runMaxHours} giờ</dd></div>
      </dl>
      <h4>Map ({rules.mapSet.length})</h4>
      <ul aria-label="Danh sách map của phiên bản">
        {rules.mapSet.map((entry, index) => (
          <li key={`${entry.mapId}-${index}`}><strong>{entry.mapId}</strong> <code>{entry.checksum}</code></li>
        ))}
      </ul>
      <p className="field-help">Chỉ hiển thị mã bản đồ và checksum</p>
    </div>
  );
}

type DetailState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly id: string }
  | { readonly status: 'error'; readonly id: string }
  | { readonly status: 'ready'; readonly detail: RuleSetDetail };

export function RuleSetArchive({ ruleSets, rounds, onUseAsBase }: Readonly<{
  ruleSets: readonly RuleSetSummary[];
  rounds: readonly RoundSummary[];
  onUseAsBase: (version: number, rules: RoundRuleSetRulesV1) => void;
}>) {
  const [detail, setDetail] = useState<DetailState>({ status: 'idle' });
  const sorted = sortRuleSetsNewestFirst(ruleSets);
  const newestId = sorted[0]?.id;
  const selectedId = detail.status === 'idle' ? null : detail.status === 'ready' ? detail.detail.id : detail.id;

  async function select(id: string) {
    setDetail({ status: 'loading', id });
    try {
      const loaded = await getRuleSetDetail(id);
      setDetail((current) => current.status === 'loading' && current.id === id ? { status: 'ready', detail: loaded } : current);
    } catch {
      setDetail((current) => current.status === 'loading' && current.id === id ? { status: 'error', id } : current);
    }
  }

  return (
    <section className="rule-set-archive" aria-label="Lưu trữ phiên bản bộ luật">
      <h3>Các phiên bản bộ luật</h3>
      {sorted.length === 0 ? <p>Chưa có phiên bản nào.</p> : (
        <ul aria-label="Danh sách phiên bản">
          {sorted.map((entry) => {
            const using = roundsUsingRuleSet(rounds, entry.id);
            return (
              <li key={entry.id}>
                <button type="button" aria-pressed={selectedId === entry.id} aria-current={selectedId === entry.id ? 'true' : undefined} onClick={() => void select(entry.id)}>
                  <span className="rule-set-title">v{entry.version} · {entry.rulesSha256.slice(0, 8)}</span>
                  <span className="rule-set-meta">{entry.reason} · {formatCreatedAt(entry.createdAt)}</span>
                  <span className="rule-set-badges">
                    {entry.id === newestId && <span className="badge">Mới nhất</span>}
                    <span className="badge">{using.length > 0 ? `Đang dùng bởi Round ${using.map((round) => round.roundNumber).join(', ')}` : 'Chưa dùng'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rule-set-detail-region" aria-live="polite">
        {detail.status === 'loading' && <p role="status">Đang tải phiên bản…</p>}
        {detail.status === 'error' && (
          <div role="alert">
            <p>Không thể tải phiên bản bộ luật.</p>
            <button type="button" onClick={() => void select(detail.id)}>Thử lại</button>
          </div>
        )}
        {detail.status === 'ready' && (
          <>
            <RuleSetReadOnly detail={detail.detail} />
            <div className="rule-set-actions">
              <button type="button" onClick={() => onUseAsBase(detail.detail.version, detail.detail.rules)}>Dùng làm cơ sở cho phiên bản mới</button>
              <button type="button" onClick={() => setDetail({ status: 'idle' })}>Quay lại bản hiện hành</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
