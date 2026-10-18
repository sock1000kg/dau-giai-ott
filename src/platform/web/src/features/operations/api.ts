export type PrivilegedActionKind = 'suspend' | 'unsuspend' | 'revoke' | 'cancel' | 'rerun';
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
  readonly page?: number;
}

export interface Pagination {
  readonly page: number;
  readonly totalPages: number;
  readonly totalItems: number;
}

export interface Paged<T> {
  readonly items: readonly T[];
  readonly pagination: Pagination;
}

export interface TeamOption {
  readonly id: string;
  readonly name: string;
  readonly representativeEmail: string | null;
}

export interface MatchOption {
  readonly matchId: string;
  readonly seriesId: string;
  readonly stage: string;
  readonly gameNumber: number;
  readonly status: string;
  readonly teams: { readonly x: { readonly id: string; readonly name: string }; readonly o: { readonly id: string; readonly name: string } };
}

export interface MatchFilters {
  readonly stage?: string;
  readonly teamId?: string;
  readonly page?: number;
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
  SUBMISSION_NOT_FLAGGED: 'Submission chưa bị gắn cờ trùng lặp.',
  IDEMPOTENCY_KEY_REUSED: 'Khóa idempotency đã dùng cho yêu cầu khác. Vui lòng thao tác lại.',
  TEAM_NOT_FOUND: 'Không tìm thấy đội.',
  SUBMISSION_NOT_FOUND: 'Không tìm thấy submission.',
  MATCH_NOT_FOUND: 'Không tìm thấy trận.',
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

function pagination(source: unknown, fallbackPage: number, itemCount: number): Pagination {
  const raw = (source ?? {}) as { page?: unknown; totalPages?: unknown; totalItems?: unknown; total?: unknown };
  const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    page: number(raw.page, fallbackPage),
    totalPages: Math.max(1, number(raw.totalPages, 1)),
    totalItems: number(raw.totalItems ?? raw.total, itemCount),
  };
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

function paged<T>(body: unknown, page: number): Paged<T> {
  const list = items<T>(body);
  return { items: list, pagination: pagination((body as { pagination?: unknown }).pagination, page, list.length) };
}

export async function listTeams(): Promise<readonly TeamOption[]> {
  const body = await request('/api/v1/admin/teams') as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error('Invalid operations response');
  return body.data as TeamOption[];
}

export async function listMatches(filters: MatchFilters = {}): Promise<Paged<MatchOption>> {
  const page = filters.page ?? 1;
  const body = await request(`/api/v1/results/matches${query({ stage: filters.stage, teamId: filters.teamId, page: page > 1 ? page : undefined, pageSize: 100 })}`) as { data?: { items?: unknown; pagination?: unknown } };
  if (!Array.isArray(body.data?.items)) throw new Error('Invalid operations response');
  const list = body.data.items as MatchOption[];
  return { items: list, pagination: pagination(body.data.pagination, page, list.length) };
}

export async function listAudit(filters: AuditFilters): Promise<Paged<AuditItem>> {
  const page = filters.page ?? 1;
  const body = await request(`${BASE}/audit${query({ action: filters.action, targetType: filters.targetType, targetId: filters.targetId, page: page > 1 ? page : undefined })}`);
  return paged<AuditItem>(body, page);
}

export async function listQueueOverrides(): Promise<readonly QueueOverride[]> {
  return items<QueueOverride>(await request('/api/v1/public/queue-overrides'));
}
