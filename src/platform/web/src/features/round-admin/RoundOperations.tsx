import { useCallback, useEffect, useState } from 'react';
import { Select } from '../../ui/index.ts';
import {
  createRound,
  getRound,
  getRuleSetDetail,
  listRounds,
  listRuleSets,
  listTeamsCount,
  RoundAdminApiError,
  transitionRound,
  type RoundActionType,
  type RoundStatus,
  type RoundSummary,
  type RuleSetSummary,
} from './api.ts';
import { formatVietnamDateTime } from '../../lib/format-date.ts';
import { estimateWorstCase, formatDuration } from './estimate.ts';
import type { RoundRuleSetRulesV1 } from './rules-form.ts';

const STATUS_LABELS: Record<RoundStatus, string> = {
  DRAFT_RULES: 'Nháp bộ luật',
  SUBMISSION_OPEN: 'Đang mở nộp bài',
  SUBMISSION_CLOSED: 'Đã đóng nộp bài',
  RUNNING: 'Đang chạy',
  SETTLING: 'Đang quyết toán',
  RATED: 'Đã xếp hạng',
  PUBLISHED: 'Đã công bố',
};

const ACTION_LABELS: Record<Exclude<RoundActionType, 'reconcile'>, string> = {
  open: 'Mở nộp bài',
  close: 'Đóng nộp bài',
  start: 'Bắt đầu round',
  pause: 'Tạm dừng',
  resume: 'Tiếp tục',
  publish: 'Công bố',
};

const RECONCILE_HELP = 'Nếu mọi series đã kết thúc: chuyển round sang chốt kết quả và áp dụng Elo. Không có tác dụng nếu round chưa xong; an toàn khi bấm lại.';

function failureMessage(error: unknown): string {
  if (error instanceof RoundAdminApiError && error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (error instanceof RoundAdminApiError && error.status === 403) return 'Tài khoản không có quyền quản lý round.';
  if (error instanceof RoundAdminApiError && error.code === 'IDEMPOTENCY_KEY_REUSED') {
    return 'Khóa idempotency đã dùng cho yêu cầu khác — đã tải lại trạng thái mới.';
  }
  if (error instanceof RoundAdminApiError && error.code === 'ROUND_GRACE_NOT_ENDED') {
    const graceEndsAt = typeof error.info.graceEndsAt === 'string' ? error.info.graceEndsAt : null;
    return graceEndsAt !== null
      ? `Chưa thể đóng nộp bài: thời gian ân hạn kết thúc lúc ${formatVietnamDateTime(graceEndsAt)} (giờ Việt Nam).`
      : 'Chưa thể đóng nộp bài: thời gian ân hạn chưa kết thúc.';
  }
  if (error instanceof RoundAdminApiError && error.code === 'ROUND_NOT_OPEN') {
    return 'Không thể đóng nộp bài: round hiện không ở trạng thái đang mở nộp bài.';
  }
  if (error instanceof RoundAdminApiError && error.code === 'ROUND_RULE_SET_MISSING') {
    return 'Không thể đóng nộp bài: round chưa khóa bộ luật hợp lệ.';
  }
  if (error instanceof RoundAdminApiError && error.code === 'ROUND_TRANSITION_INVALID') {
    return 'Thao tác không còn hợp lệ ở trạng thái hiện tại.';
  }
  return 'Không thể hoàn tất thao tác round. Vui lòng thử lại.';
}

function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

export function RoundOperations({ stage }: Readonly<{ stage: string }>) {
  const [rounds, setRounds] = useState<readonly RoundSummary[]>([]);
  const [ruleSets, setRuleSets] = useState<readonly RuleSetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRound, setBusyRound] = useState<string | null>(null);
  const [pending, setPending] = useState<{ readonly round: RoundSummary; readonly action: Exclude<RoundActionType, 'reconcile'> } | null>(null);
  const [reason, setReason] = useState('');
  const [chosenRuleSetId, setChosenRuleSetId] = useState('');
  const [typedNumber, setTypedNumber] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startContext, setStartContext] = useState<{ readonly teamCount: number; readonly rules: RoundRuleSetRulesV1 | null } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createReason, setCreateReason] = useState('');
  const [graceByRound, setGraceByRound] = useState<Readonly<Record<string, string>>>({});

  const loadGraceTimes = useCallback(async (list: readonly RoundSummary[]) => {
    const entries = await Promise.all(list
      .filter((round) => round.status === 'SUBMISSION_OPEN' && round.ruleSetId !== null)
      .map(async (round): Promise<readonly [string, string] | null> => {
        try {
          const detail = await getRuleSetDetail(round.ruleSetId as string);
          const graceEndsAt = detail.rules.schedule.graceEndsAt;
          return typeof graceEndsAt === 'string' ? [round.id, graceEndsAt] : null;
        } catch {
          return null; // The close button still works without the hint.
        }
      }));
    setGraceByRound(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedRounds, fetchedRuleSets] = await Promise.all([listRounds(stage), listRuleSets(stage)]);
      setRounds(fetchedRounds);
      setRuleSets(fetchedRuleSets);
      void loadGraceTimes(fetchedRounds);
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [stage, loadGraceTimes]);

  useEffect(() => { void load(); }, [load]);

  function replaceRound(updated: RoundSummary) {
    setRounds((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function reconcileAfterError(round: RoundSummary) {
    try {
      replaceRound(await getRound(round.id));
    } catch {
      // Keep the last known state when even the refetch fails.
    }
  }

  async function runAction(round: RoundSummary, action: RoundActionType, options: { readonly reason: string; readonly ruleSetId?: string; readonly idempotencyKey?: string }) {
    setBusyRound(round.id);
    setMessage(null);
    setError(null);
    try {
      const updated = await transitionRound(round.id, action, options);
      replaceRound(updated);
      setMessage(updated.replayed === true ? 'Máy chủ đã xử lý yêu cầu trước đó — không tạo thao tác mới.' : 'Đã áp dụng thao tác.');
    } catch (cause) {
      await reconcileAfterError(round);
      if (cause instanceof RoundAdminApiError && (cause.code === 'ROUND_TRANSITION_INVALID' || cause.status === 404 || cause.code === 'IDEMPOTENCY_KEY_REUSED') && action !== 'close') {
        setMessage('Trạng thái đã thay đổi ở nơi khác — đã tải lại.');
      } else {
        setError(failureMessage(cause));
      }
      throw cause;
    } finally {
      setBusyRound(null);
    }
  }

  function openActionDialog(round: RoundSummary, action: Exclude<RoundActionType, 'reconcile'>) {
    setPending({ round, action });
    setReason('');
    setTypedNumber('');
    setStartContext(null);
    const fallback = round.ruleSetId ?? ruleSets[0]?.id ?? '';
    setChosenRuleSetId(fallback);
    if (action === 'start') {
      const key = crypto.randomUUID();
      setIdempotencyKey(key);
      void (async () => {
        try {
          const [count, detail] = await Promise.all([
            listTeamsCount(),
            round.ruleSetId ? getRuleSetDetail(round.ruleSetId).catch(() => null) : Promise.resolve(null),
          ]);
          setStartContext({ teamCount: count, rules: detail?.rules ?? null });
        } catch {
          setStartContext({ teamCount: 0, rules: null });
        }
      })();
    } else {
      setIdempotencyKey('');
    }
  }

  function closeActionDialog() {
    setPending(null);
    setReason('');
    setTypedNumber('');
    setIdempotencyKey('');
    setStartContext(null);
    setSubmitting(false);
  }

  async function submitPending(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending === null || submitting) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 1 || trimmedReason.length > 500) return;
    if (pending.action === 'open' && chosenRuleSetId.length === 0) return;
    if (pending.action === 'start') {
      if (typedNumber.trim() !== String(pending.round.roundNumber) || idempotencyKey.length === 0) return;
    }
    setSubmitting(true);
    try {
      const transition: { reason: string; ruleSetId?: string; idempotencyKey?: string } = { reason: trimmedReason };
      if (pending.action === 'open') transition.ruleSetId = chosenRuleSetId;
      if (pending.action === 'start') {
        if (pending.round.ruleSetId !== null) transition.ruleSetId = pending.round.ruleSetId;
        transition.idempotencyKey = idempotencyKey;
      }
      await runAction(pending.round, pending.action, transition);
      // Discard the confirmation key after a successful attempt.
      closeActionDialog();
    } catch {
      // Keep the dialog open with the same key so the operator can retry idempotently.
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReconcile(round: RoundSummary) {
    setBusyRound(round.id);
    setMessage(null);
    setError(null);
    try {
      replaceRound(await transitionRound(round.id, 'reconcile', { reason: '' }));
      setMessage('Đã đồng bộ trạng thái từ máy chủ.');
    } catch (cause) {
      await reconcileAfterError(round);
      if (cause instanceof RoundAdminApiError && (cause.code === 'ROUND_TRANSITION_INVALID' || cause.status === 404)) {
        setMessage('Trạng thái đã thay đổi ở nơi khác — đã tải lại.');
      } else {
        setError(failureMessage(cause));
      }
    } finally {
      setBusyRound(null);
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = createReason.trim();
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createRound(stage, trimmed);
      setRounds((current) => [created, ...current]);
      setMessage(`Đã tạo round ${created.roundNumber}.`);
      setShowCreate(false);
      setCreateReason('');
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  function ruleSetLabel(ruleSetId: string | null): string {
    if (ruleSetId === null) return 'Chưa khóa bộ luật';
    const found = ruleSets.find((entry) => entry.id === ruleSetId);
    if (!found) return 'Bộ luật đã khóa';
    return `v${found.version} (${shortSha(found.rulesSha256)})`;
  }

  const startEstimate = pending?.action === 'start' && startContext?.rules
    ? estimateWorstCase({
      teamCount: startContext.teamCount,
      concurrency: 4,
      matchWallClockMs: startContext.rules.timeControl.matchWallClockMs,
      runMaxHours: startContext.rules.schedule.runMaxHours,
    })
    : null;
  const startLockedVersion = pending !== null ? ruleSets.find((entry) => entry.id === pending.round.ruleSetId) : undefined;

  return (
    <section className="round-operations" aria-label="Vận hành round">
      <h2>Vận hành round</h2>
      <div className="round-toolbar">
        <button type="button" onClick={() => setShowCreate(true)}>Tạo round mới…</button>
        <button type="button" onClick={() => void load()} disabled={loading || busyRound !== null}>Làm mới</button>
      </div>

      {message !== null && <p role="status" className="round-message">{message}</p>}
      {error !== null && <div role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Thử lại</button></div>}
      {loading && <p role="status" aria-busy="true">Đang tải danh sách round…</p>}
      {!loading && error === null && rounds.length === 0 && <p>Chưa có round nào ở stage này.</p>}

      {!loading && rounds.length > 0 && (
        <ul aria-label="Danh sách round">
          {rounds.map((round) => (
            <li key={round.id}>
              <h3>Round {round.roundNumber}</h3>
              <p>{STATUS_LABELS[round.status]}</p>
              <p>{ruleSetLabel(round.ruleSetId)}</p>
              {round.pausedAt !== null && <p>Tạm dừng</p>}
              <div>
                {round.allowedActions.map((action) => action === 'reconcile' ? (
                  <span key={action} className="round-reconcile">
                    <button type="button" disabled={busyRound !== null} aria-describedby={`round-reconcile-help-${round.id}`} title={RECONCILE_HELP} onClick={() => void submitReconcile(round)}>
                      Kiểm tra và chốt kết quả round
                    </button>
                    <small className="field-help" id={`round-reconcile-help-${round.id}`}>{RECONCILE_HELP}</small>
                  </span>
                ) : (
                  <span key={action}>
                    <button type="button" disabled={busyRound !== null} onClick={() => openActionDialog(round, action)}>
                      {`${ACTION_LABELS[action]}…`}
                    </button>
                    {action === 'close' && graceByRound[round.id] !== undefined && (
                      <small className="field-help">Chỉ đóng được sau khi hết ân hạn: {formatVietnamDateTime(graceByRound[round.id] as string)} (giờ Việt Nam)</small>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <form className="round-dialog" aria-label="Tạo round mới" onSubmit={(event) => void submitCreate(event)}>
          <h2>Tạo round mới</h2>
          <label htmlFor="round-create-reason">Lý do</label>
          <textarea id="round-create-reason" required minLength={1} maxLength={500} value={createReason} onChange={(event) => setCreateReason(event.target.value)} />
          <div className="round-dialog-actions">
            <button type="button" disabled={submitting} onClick={() => setShowCreate(false)}>Hủy</button>
            <button type="submit" disabled={submitting || createReason.trim().length === 0}>{submitting ? 'Đang tạo…' : 'Xác nhận tạo'}</button>
          </div>
        </form>
      )}

      {pending !== null && (
        <form className="round-dialog" aria-label={pending.action === 'start' ? 'Xác nhận bắt đầu round' : `Xác nhận ${ACTION_LABELS[pending.action].toLowerCase()}`} onSubmit={(event) => void submitPending(event)}>
          <h2>{pending.action === 'start' ? `Bắt đầu round ${pending.round.roundNumber}?` : `${ACTION_LABELS[pending.action]} round ${pending.round.roundNumber}?`}</h2>
          {pending.action === 'start' && (
            <>
              <p>Round {pending.round.roundNumber} · bộ luật {startLockedVersion ? `v${startLockedVersion.version} (${shortSha(startLockedVersion.rulesSha256)})` : 'đã khóa'} · {startContext === null ? 'đang tải…' : `${startContext.teamCount} đội`}</p>
              {startEstimate !== null && (
                <p>Ước tính worst-case: {startEstimate.games} trận, {startEstimate.waves} đợt, {formatDuration(startEstimate.worstMs)}.</p>
              )}
              <label htmlFor="round-start-number">Nhập số round để xác nhận</label>
              <input id="round-start-number" type="text" inputMode="numeric" autoComplete="off" value={typedNumber} onChange={(event) => setTypedNumber(event.target.value)} />
            </>
          )}
          {pending.action === 'open' && (
            <>
              <label htmlFor="round-open-ruleset">Phiên bản bộ luật</label>
              <Select id="round-open-ruleset" value={chosenRuleSetId} onChange={(event) => setChosenRuleSetId(event.target.value)}>
                {ruleSets.map((entry) => (
                  <option key={entry.id} value={entry.id}>v{entry.version} ({shortSha(entry.rulesSha256)})</option>
                ))}
              </Select>
            </>
          )}
          <label htmlFor="round-action-reason">Lý do</label>
          <textarea id="round-action-reason" required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="round-dialog-actions">
          <button type="button" disabled={submitting} onClick={closeActionDialog}>Hủy</button>
          <button
            type="submit"
            disabled={submitting || busyRound !== null || reason.trim().length === 0
              || (pending.action === 'open' && chosenRuleSetId.length === 0)
              || (pending.action === 'start' && (typedNumber.trim() !== String(pending.round.roundNumber) || idempotencyKey.length === 0))}
          >
            {submitting ? 'Đang gửi…' : pending.action === 'start' ? 'Xác nhận bắt đầu' : `Xác nhận ${ACTION_LABELS[pending.action].toLowerCase()}`}
          </button>
          </div>
        </form>
      )}
    </section>
  );
}
