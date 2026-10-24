import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { listSubmissions, type TeamSubmission } from '../submissions/api.ts';
import { Alert, Badge, Button, Card, Field, Page, Select } from '../../ui/index.ts';
import { createTestRun, getTestRunPolicy, listTestRuns, TestRunApiError, type TestRun, type TestRunOpponentType, type TestRunPolicy } from './api.ts';
import './test-runs.css';

const PAGE_SIZE = 20;
const ACTIVE_STATUSES = new Set<TestRun['status']>(['QUEUED', 'RUNNING']);

const statusLabels: Record<TestRun['status'], string> = {
  QUEUED: 'Đang chờ', RUNNING: 'Đang chạy', COMPLETED: 'Hoàn tất', FAILED: 'Thất bại', CANCELLED: 'Đã hủy',
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function resultText(run: TestRun): string | null {
  if (run.result === null) return null;
  const winnerSide = run.result.winnerSide;
  const reason = run.result.reason;
  if (winnerSide === 'X' || winnerSide === 'O') return `Đội ${winnerSide} thắng${typeof reason === 'string' ? ` · ${reason.replaceAll('_', ' ').toLocaleLowerCase('vi-VN')}` : ''}`;
  if (winnerSide === null) return 'Hòa';
  return 'Đã có kết quả';
}

function requestMessage(error: unknown): string {
  if (error instanceof TestRunApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.';
    if (error.status === 404) return 'Submission hoặc lượt chạy không tồn tại.';
    if (error.status === 429 || error.code === 'TEST_RUN_QUOTA_EXCEEDED') return 'Bạn đã hết lượt chạy hôm nay. Hạn mức sẽ được làm mới theo thời gian hiển thị.';
    if (error.code === 'TEST_RUN_ADMISSION_PAUSED') return 'Hệ thống đang tạm dừng nhận lượt chạy thử để ưu tiên trận chính thức.';
    if (error.status === 409) return 'Yêu cầu này không còn hợp lệ. Hãy tải lại trang rồi thử lại.';
    if (error.status === 0) return 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.';
  }
  return 'Không thể tải thông tin chạy thử. Vui lòng thử lại.';
}

function displayOpponent(run: TestRun, policy: TestRunPolicy | null): string {
  if (run.opponentType === 'OWN_SUBMISSION') {
    if (run.opponentSubmissionId === run.submissionId) {
      return 'Chính bot này (tự đấu)';
    }
    return 'Submission khác của đội';
  }
  return policy?.opponents.referenceBots.find((bot) => bot.id === run.opponentReferenceBot)?.displayName ?? run.opponentReferenceBot ?? 'Bot tham chiếu BTC';
}

export function TestRunsPage() {
  const intentKey = useRef<string | null>(null);
  const [policy, setPolicy] = useState<TestRunPolicy | null>(null);
  const [submissions, setSubmissions] = useState<readonly TeamSubmission[]>([]);
  const [runs, setRuns] = useState<readonly TestRun[]>([]);
  const [submissionId, setSubmissionId] = useState('');
  const [opponentType, setOpponentType] = useState<TestRunOpponentType>('OWN_SUBMISSION');
  const [opponentId, setOpponentId] = useState('');
  const [selectedMapKey, setSelectedMapKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const eligibleSubmissions = useMemo(() => submissions.filter((item) => item.status === 'ACTIVE' || item.status === 'VALID'), [submissions]);

  const selectedMap = useMemo(() => {
    if (!policy || !policy.maps || policy.maps.length === 0) return null;
    return policy.maps.find((m) => `${m.mapId}::${m.checksum}` === selectedMapKey) ?? policy.maps[0];
  }, [policy, selectedMapKey]);

  const loadRuns = useCallback(async () => {
    const result = await listTestRuns(1, PAGE_SIZE);
    setRuns(result.items);
  }, []);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPolicy, nextSubmissions, nextRuns] = await Promise.all([
        getTestRunPolicy(), listSubmissions(1, PAGE_SIZE), listTestRuns(1, PAGE_SIZE),
      ]);
      setPolicy(nextPolicy);
      setSubmissions(nextSubmissions.items);
      setRuns(nextRuns.items);
      const defaultSubId = nextSubmissions.items.find((item) => item.status === 'ACTIVE' || item.status === 'VALID')?.id || '';
      setSubmissionId((previous) => previous || defaultSubId);

      const defaultOpponentType: TestRunOpponentType = nextPolicy.opponents.ownSubmissionAllowed
        ? 'OWN_SUBMISSION'
        : (nextPolicy.opponents.referenceBots.length > 0 ? 'BTC_REFERENCE' : 'OWN_SUBMISSION');
      setOpponentType(defaultOpponentType);

      setOpponentId(defaultOpponentType === 'OWN_SUBMISSION'
        ? defaultSubId
        : (nextPolicy.opponents.referenceBots[0]?.id || defaultSubId));

      const firstMap = nextPolicy.maps?.[0];
      if (firstMap) {
        setSelectedMapKey((previous) => previous || `${firstMap.mapId}::${firstMap.checksum}`);
      }
    } catch (cause) {
      setError(requestMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPage(); }, [loadPage]);

  useEffect(() => {
    if (!runs.some((run) => ACTIVE_STATUSES.has(run.status))) return undefined;
    const timeout = window.setTimeout(() => {
      void loadRuns().catch((cause: unknown) => setError(requestMessage(cause)));
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [loadRuns, runs]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || policy === null || submissionId === '') return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    if (intentKey.current === null) intentKey.current = crypto.randomUUID();
    try {
      await createTestRun({
        submissionId,
        opponentType,
        ...(opponentType === 'BTC_REFERENCE' ? { opponentReferenceBot: opponentId } : { opponentSubmissionId: opponentId }),
        ...(policy.roundId !== null ? { roundId: policy.roundId } : {}),
        ...(selectedMap ? { mapId: selectedMap.mapId, mapChecksum: selectedMap.checksum } : {}),
      }, intentKey.current);
      intentKey.current = null;
      setSuccess('Đã nhận yêu cầu chạy thử. Trạng thái sẽ tự cập nhật trong danh sách bên dưới.');
      await Promise.all([loadRuns(), getTestRunPolicy().then(setPolicy)]);
    } catch (cause) {
      // Keep the intent key for a safe retry after a network failure.
      setError(requestMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  const paused = policy?.admissionPaused === true;
  const quotaEmpty = policy !== null && policy.quota.remaining <= 0;
  const noSubmission = eligibleSubmissions.length === 0;
  const hasReferenceBots = (policy?.opponents.referenceBots.length ?? 0) > 0;
  const ownSubmissionAllowed = Boolean(policy?.opponents.ownSubmissionAllowed);
  const hasOpponentOptions = hasReferenceBots || ownSubmissionAllowed;

  return (
    <Page title="Chạy thử bot" description="Thử submission của đội trong môi trường thi đấu cô lập. Lượt chạy thử không ảnh hưởng Elo.">
      <p className="eyebrow">CỔNG ĐỘI THI</p>
      <section className="test-runs-overview" aria-label="Hạn mức chạy thử">
        {loading ? <Card><p role="status" aria-busy="true">Đang tải chính sách chạy thử…</p></Card> : policy && <Card className="test-runs-quota">
          <div>
            <p className="test-runs-eyebrow">LƯỢT CHẠY HÔM NAY</p>
            <strong>{policy.quota.remaining} / {policy.quota.limit}</strong>
            <p>Còn {policy.quota.remaining} lượt chạy hôm nay · làm mới {formatTime(policy.quota.resetsAt)}</p>
          </div>
          <Badge accent>{paused ? 'Đang tạm dừng' : 'Ưu tiên thấp'}</Badge>
        </Card>}
      </section>

      {error && <Alert tone="danger"><div className="test-runs-alert"><p>{error}</p><Button variant="secondary" onClick={() => void loadPage()}>Tải lại</Button></div></Alert>}
      {success && <Alert tone="success"><p role="status" aria-live="polite">{success}</p></Alert>}
      {paused && <Alert tone="warning">BTC đang ưu tiên trận chính thức; hệ thống tạm dừng nhận lượt chạy thử mới.</Alert>}
      {noSubmission && !loading && <Alert tone="warning">Bạn cần có submission ở trạng thái VALID hoặc ACTIVE trước khi chạy thử.</Alert>}

      <div className="test-runs-layout">
        <Card title="Tạo lượt chạy thử" className="test-runs-create">
          <form className="test-runs-form" onSubmit={(event) => void handleSubmit(event)}>
            <Field label="Bot của đội" help="Chỉ dùng submission đã qua kiểm tra và còn hợp lệ.">
              <Select
                value={submissionId}
                onChange={(event) => {
                  const newId = event.target.value;
                  if (opponentType === 'OWN_SUBMISSION' && opponentId === submissionId) {
                    setOpponentId(newId);
                  }
                  setSubmissionId(newId);
                }}
                disabled={loading || noSubmission || submitting}
                required
              >
                <option value="" disabled>Chọn submission</option>
                {eligibleSubmissions.map((submission) => <option key={submission.id} value={submission.id}>{submission.id.slice(0, 8)} · {submission.status}</option>)}
              </Select>
            </Field>
            {hasOpponentOptions ? (
              <Field label="Bot đối thủ">
                <Select
                  value={opponentType}
                  onChange={(event) => {
                    const nextType = event.target.value as TestRunOpponentType;
                    setOpponentType(nextType);
                    if (nextType === 'OWN_SUBMISSION') {
                      setOpponentId(submissionId || eligibleSubmissions[0]?.id || '');
                    } else {
                      setOpponentId(policy?.opponents.referenceBots[0]?.id || '');
                    }
                  }}
                  disabled={loading || submitting}
                >
                  {ownSubmissionAllowed ? <option value="OWN_SUBMISSION">Bot của đội</option> : null}
                  {hasReferenceBots ? <option value="BTC_REFERENCE">Bot tham chiếu BTC</option> : null}
                </Select>
              </Field>
            ) : null}
            {opponentType === 'BTC_REFERENCE' && hasReferenceBots ? (
              <Field label="Bot tham chiếu BTC">
                <Select value={opponentId} onChange={(event) => setOpponentId(event.target.value)} disabled={loading || submitting} required>
                  {policy?.opponents.referenceBots.map((bot) => <option key={bot.id} value={bot.id}>{bot.displayName}</option>)}
                </Select>
              </Field>
            ) : opponentType === 'OWN_SUBMISSION' && ownSubmissionAllowed ? (
              <Field label="Submission đối thủ" help="Có thể chọn chính bot đang thử để tự đấu.">
                <Select value={opponentId} onChange={(event) => setOpponentId(event.target.value)} disabled={loading || submitting || eligibleSubmissions.length === 0} required>
                  <option value="" disabled>Chọn submission</option>
                  {eligibleSubmissions.map((submission) => {
                    const isSelf = submission.id === submissionId;
                    const label = isSelf
                      ? `${submission.id.slice(0, 8)} · ${formatTime(submission.createdAt)} (chính bot này)`
                      : `${submission.id.slice(0, 8)} · ${submission.status}`;
                    return <option key={submission.id} value={submission.id}>{label}</option>;
                  })}
                </Select>
              </Field>
            ) : (
              <p className="test-runs-empty" role="status">Bot tham chiếu BTC chưa được cấu hình cho môi trường này.</p>
            )}
            {policy?.maps && policy.maps.length > 0 && (
              <div className="test-runs-map-field">
                <Field label="Bản đồ">
                  <Select
                    value={selectedMapKey}
                    onChange={(event) => setSelectedMapKey(event.target.value)}
                    disabled={loading || submitting}
                    required
                  >
                    {policy.maps.map((map) => (
                      <option key={`${map.mapId}::${map.checksum}`} value={`${map.mapId}::${map.checksum}`}>
                        {map.name ? `${map.name} (${map.mapId} · ${map.checksum.slice(0, 8)})` : `${map.mapId} (${map.checksum.slice(0, 8)})`}
                      </option>
                    ))}
                  </Select>
                </Field>
                {selectedMap && (
                  <p className="test-runs-map-download">
                    <a
                      href={`/api/v1/public/maps/${encodeURIComponent(selectedMap.mapId)}?checksum=${encodeURIComponent(selectedMap.checksum)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                    >
                      Xem/tải bản đồ
                    </a>
                  </p>
                )}
              </div>
            )}
            <Button type="submit" disabled={loading || submitting || paused || quotaEmpty || noSubmission || opponentId === '' || !hasOpponentOptions} loading={submitting}>
              {submitting ? 'Đang gửi…' : 'Chạy thử'}
            </Button>
          </form>
          <p className="test-runs-note">Lượt chạy thử đứng sau trận chính thức. Kết quả, replay và log chỉ đội bạn cùng BTC mới xem được.</p>
        </Card>

        <Card title="Lượt thử gần đây" className="test-runs-history">
          {loading ? <p role="status" aria-busy="true">Đang tải danh sách…</p> : runs.length === 0 ? <p className="test-runs-empty">Chưa có lượt chạy thử. Tạo lượt đầu tiên để kiểm tra bot.</p> : (
            <ol className="test-runs-list">
              {runs.map((run) => <li key={run.id} className="test-runs-item">
                <div className="test-runs-item-heading">
                  <div><strong>{run.submissionId.slice(0, 8)} đấu {displayOpponent(run, policy)}</strong><time dateTime={run.createdAt}>{formatTime(run.createdAt)}</time></div>
                  <Badge accent={run.status === 'COMPLETED'}>{statusLabels[run.status]}</Badge>
                </div>
                {run.status === 'COMPLETED' && resultText(run) && <p className="test-runs-result">{resultText(run)}</p>}
                {run.failureReason && <p className="test-runs-failure">{run.failureReason}</p>}
                {run.status === 'COMPLETED' && <a className="test-runs-replay-link" href={`/team/test-runs/${encodeURIComponent(run.id)}/replay`}>Xem replay đã xác minh</a>}
                {(run.stderrX || run.stderrO) && <details className="test-runs-stderr"><summary>Log lỗi đã giới hạn</summary><pre>{[run.stderrX, run.stderrO].filter(Boolean).join('\n')}</pre></details>}
              </li>)}
            </ol>
          )}
          <div className="test-runs-history-actions"><Button variant="secondary" disabled={loading} onClick={() => void loadRuns().catch((cause: unknown) => setError(requestMessage(cause)))}>Làm mới danh sách</Button></div>
        </Card>
      </div>
    </Page>
  );
}
