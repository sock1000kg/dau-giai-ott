export type PrivilegedActionKind = 'suspend' | 'unsuspend' | 'revoke' | 'cancel' | 'rerun';
export type CaseKind = 'ANOMALY' | 'DUPLICATE' | 'APPEAL';
export type CaseStatus = 'OPEN' | 'UNDER_REVIEW' | 'DECIDED' | 'CLOSED';
export type CaseDecision = 'NO_ACTION' | 'WARN' | 'REVOKE_SUBMISSION' | 'SUSPEND_TEAM' | 'RERUN_APPROVED' | 'APPEAL_UPHELD' | 'APPEAL_REJECTED';

export const CASE_KINDS: readonly CaseKind[] = ['ANOMALY', 'DUPLICATE', 'APPEAL'];
export const CASE_DECISIONS: readonly CaseDecision[] = ['NO_ACTION', 'WARN', 'REVOKE_SUBMISSION', 'SUSPEND_TEAM', 'RERUN_APPROVED', 'APPEAL_UPHELD', 'APPEAL_REJECTED'];

export interface CaseSummary {
  readonly id: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly teamId: string | null;
  readonly matchId: string | null;
  readonly submissionId: string | null;
  readonly openedAt: string;
  readonly decidedAt: string | null;
}

export interface CaseEvent {
  readonly seq: number;
  readonly eventType: string;
  readonly reason: string;
  readonly decision: CaseDecision | null;
  readonly createdAt: string;
}

export interface CaseDetail extends CaseSummary { readonly events: readonly CaseEvent[] }

export interface AuditItem {
  readonly id: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
}

export interface QueueOverride {
  readonly id: string;
  readonly action: string;
  readonly matchOpaqueId: string;
  readonly publicReason: string;
  readonly createdAt: string;
}

export interface AuditFilters {
  readonly action?: string;
  readonly targetType?: string;
  readonly targetId?: string;
}

export class OperationsApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Operations request failed');
    this.name = 'OperationsApiError';
    this.status = status;
    this.code = code;
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_REASON: 'Lý do phải có từ 1 đến 500 ký tự.',
  INVALID_PUBLIC_REASON: 'Lý do công khai phải có từ 1 đến 200 ký tự.',
  RERUN_CONFIRMATION_REQUIRED: 'Cần xác nhận đây là lỗi hạ tầng trước khi chạy lại.',
  RERUN_NOT_INFRA_FAILURE: 'Không chạy lại được: lỗi không thuộc nhóm lỗi hạ tầng.',
  RERUN_MATCH_NOT_FAILED: 'Không chạy lại được: trận chưa ở trạng thái FAILED.',
  RERUN_RESULT_EXISTS: 'Không chạy lại được: trận đã có kết quả.',
  RERUN_ROUND_SETTLED: 'Không chạy lại được: round đã quyết toán hoặc đã áp dụng Elo.',
  RERUN_SERIES_CANCELLED_BY_OPERATOR: 'Không chạy lại được: series đã bị BTC hủy.',
  RERUN_ALREADY_PENDING: 'Đã có yêu cầu chạy lại đang chờ phát hành.',
  CANCEL_NOT_ALLOWED: 'Chỉ hủy được trận SCHEDULED hoặc FAILED.',
  TRANSITION_INVALID: 'Thao tác không hợp lệ ở trạng thái hiện tại.',
  CASE_TRANSITION_INVALID: 'Không thể chuyển trạng thái hồ sơ như vậy.',
  CASE_LOCKED: 'Hồ sơ đã có quyết định, không thể thêm bằng chứng.',
  DECISION_NOT_ALLOWED_FOR_KIND: 'Quyết định không áp dụng cho loại hồ sơ này.',
  CASE_ALREADY_EXISTS: 'Đã có hồ sơ cho đối tượng này.',
  SUBMISSION_NOT_FLAGGED: 'Submission chưa bị gắn cờ trùng lặp.',
  IDEMPOTENCY_KEY_REUSED: 'Khóa idempotency đã dùng cho yêu cầu khác. Vui lòng thao tác lại.',
  TEAM_NOT_FOUND: 'Không tìm thấy đội.',
  SUBMISSION_NOT_FOUND: 'Không tìm thấy submission.',
  MATCH_NOT_FOUND: 'Không tìm thấy trận.',
  CASE_NOT_FOUND: 'Không tìm thấy hồ sơ.',
  CASE_SUBJECT_NOT_FOUND: 'Không tìm thấy đối tượng của hồ sơ.',
  CASE_SUBJECT_REQUIRED: 'Hồ sơ cần ít nhất một đối tượng hợp lệ.',
  INVALID_EVIDENCE: 'Bằng chứng không hợp lệ.',
};

export function operationsErrorMessage(error: unknown): string {
  if (error instanceof OperationsApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
    if (error.code !== null && MESSAGES[error.code] !== undefined) return MESSAGES[error.code]!;
  }
  return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

function newId(): string {
  return crypto.randomUUID();
}

async function request(path: string, init: RequestInit & { readonly idempotencyKey?: string } = {}): Promise<unknown> {
  const { idempotencyKey, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('x-correlation-id', newId());
  if (idempotencyKey !== undefined) headers.set('idempotency-key', idempotencyKey);
  if (rest.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...rest, headers, credentials: 'include' });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const root = typeof body === 'object' && body !== null && 'error' in body ? (body as { error?: { code?: unknown } }).error : undefined;
    throw new OperationsApiError(response.status, typeof root?.code === 'string' ? root.code : null);
  }
  return body;
}

const BASE = '/api/v1/admin/operations';

function items<T>(body: unknown): readonly T[] {
  const data = (body as { data?: { items?: unknown } } | undefined)?.data?.items;
  if (!Array.isArray(data)) throw new Error('Invalid operations response');
  return data as T[];
}

export function newIdempotencyKey(): string {
  return newId();
}

export interface PrivilegedInput {
  readonly kind: PrivilegedActionKind;
  readonly targetId: string;
  readonly reason: string;
  readonly publicReason?: string;
  readonly verifiedInfraFailure?: boolean;
}

export async function runPrivilegedAction(input: PrivilegedInput, idempotencyKey: string): Promise<void> {
  const target = encodeURIComponent(input.targetId);
  const paths: Record<PrivilegedActionKind, string> = {
    suspend: `/teams/${target}/suspend`,
    unsuspend: `/teams/${target}/unsuspend`,
    revoke: `/submissions/${target}/revoke`,
    cancel: `/matches/${target}/cancel`,
    rerun: `/matches/${target}/rerun`,
  };
  const body: Record<string, unknown> = { reason: input.reason };
  if (input.kind === 'cancel' || input.kind === 'rerun') body.publicReason = input.publicReason ?? '';
  if (input.kind === 'rerun') body.verifiedInfraFailure = input.verifiedInfraFailure === true;
  await request(`${BASE}${paths[input.kind]}`, { method: 'POST', body: JSON.stringify(body), idempotencyKey });
}

export async function listCases(): Promise<readonly CaseSummary[]> {
  return items<CaseSummary>(await request(`${BASE}/cases`));
}

export async function getCase(id: string): Promise<CaseDetail> {
  const body = await request(`${BASE}/cases/${encodeURIComponent(id)}`) as { data?: CaseDetail };
  if (body.data === undefined) throw new Error('Invalid operations response');
  return body.data;
}

export async function openCase(input: { readonly kind: CaseKind; readonly subjectId: string; readonly reason: string; readonly summary: string }): Promise<void> {
  const subject: Record<CaseKind, string> = { ANOMALY: 'matchId', DUPLICATE: 'submissionId', APPEAL: 'teamId' };
  await request(`${BASE}/cases`, {
    method: 'POST',
    body: JSON.stringify({ kind: input.kind, reason: input.reason, [subject[input.kind]]: input.subjectId, evidence: { summary: input.summary } }),
  });
}

export async function addCaseEvidence(id: string, reason: string, summary: string): Promise<void> {
  await request(`${BASE}/cases/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: JSON.stringify({ reason, evidence: { summary } }) });
}

export async function changeCaseStatus(id: string, reason: string, status: 'UNDER_REVIEW' | 'CLOSED'): Promise<void> {
  await request(`${BASE}/cases/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ reason, status }) });
}

export async function decideCase(id: string, reason: string, decision: CaseDecision): Promise<void> {
  await request(`${BASE}/cases/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ reason, decision }) });
}

export async function listAudit(filters: AuditFilters): Promise<readonly AuditItem[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') params.set(key, value);
  const query = params.toString();
  return items<AuditItem>(await request(`${BASE}/audit${query === '' ? '' : `?${query}`}`));
}

export async function listQueueOverrides(): Promise<readonly QueueOverride[]> {
  return items<QueueOverride>(await request('/api/v1/public/queue-overrides'));
}
