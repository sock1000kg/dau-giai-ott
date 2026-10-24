export interface ResultBundleKeyItem {
  readonly keyId: string;
  readonly fingerprint: string;
  readonly algorithm: 'Ed25519';
  readonly allowlistedAt: string;
  readonly revokedAt: string | null;
  readonly bundleCount: number;
}

export interface AllowlistKeyRequest {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly fingerprintConfirmation: string;
  readonly reason: string;
}

export interface DryRunResponse {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly keyId: string;
  readonly fingerprint: string;
  readonly artifacts: number;
  readonly valid: true;
}

export interface PublishResponse {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly keyId: string;
  readonly manifestSha256: string;
  readonly importedAt: string;
  readonly status: 'VERIFIED';
  readonly replayed: boolean;
}

export class ResultBundleApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'ResultBundleApiError';
    this.code = code;
    this.status = status;
  }
}

export const RESULT_BUNDLE_ERROR_MESSAGES = {
  RESULT_BUNDLE_KEY_PRIVATE_REJECTED: 'Khóa riêng (PRIVATE KEY) không được phép nhập vào hệ thống.',
  RESULT_BUNDLE_KEY_INVALID: 'Khóa công khai Ed25519 không hợp lệ hoặc không đúng định dạng SPKI PEM.',
  RESULT_BUNDLE_KEY_ID_INVALID: 'Mã định danh khóa (keyId) không đúng định dạng (1-128 ký tự chữ, số, gạch dưới, gạch ngang).',
  FINGERPRINT_MISMATCH: 'Mã vân tay xác nhận không khớp với vân tay tính từ khóa công khai.',
  RESULT_BUNDLE_KEY_EXISTS: 'Mã định danh khóa đã tồn tại với một khóa công khai khác.',
  RESULT_BUNDLE_KEY_NOT_FOUND: 'Không tìm thấy khóa ResultBundle.',
  RESULT_BUNDLE_KEY_UNKNOWN: 'Khóa ký không nằm trong danh sách được phép hoặc đã bị thu hồi.',
  RESULT_BUNDLE_SIGNATURE_INVALID: 'Chữ ký Ed25519 không hợp lệ hoặc dữ liệu manifest đã bị thay đổi.',
  RESULT_BUNDLE_ARTIFACT_TAMPERED: 'Dữ liệu tệp đính kèm không khớp với mã hash SHA-256 hoặc kích thước khai báo trong manifest.',
  RESULT_BUNDLE_ARTIFACT_MISSING: 'Thiếu tệp đính kèm đã được khai báo trong manifest.',
  RESULT_BUNDLE_ARTIFACT_UNLISTED: 'Gói bundle chứa tệp không có trong danh mục manifest.',
  RESULT_BUNDLE_ARTIFACT_INVALID: 'Dữ liệu tệp đính kèm không đúng schema hoặc vi phạm cấu trúc giải đấu.',
  RESULT_BUNDLE_MANIFEST_INVALID: 'Cấu trúc manifest của bundle không hợp lệ.',
  RESULT_BUNDLE_INPUT_INVALID: 'Gói bundle không đúng định dạng JSON yêu cầu.',
  RESULT_BUNDLE_VERSION_CONFLICT: 'Phiên bản bundle này đã tồn tại với nội dung khác.',
  INVALID_REASON: 'Lý do bắt buộc phải từ 1 đến 500 ký tự.',
} as const;

export function translateResultBundleError(code: string, fallback?: string): string {
  return (RESULT_BUNDLE_ERROR_MESSAGES as Record<string, string>)[code] ?? fallback ?? `Lỗi không xác định (${code})`;
}

/**
 * Live fingerprint computation in the browser using Web Crypto API.
 *
 * Definition: SHA-256 hex digest of the SubjectPublicKeyInfo (SPKI) DER bytes.
 */
export async function computeClientFingerprint(pem: string): Promise<string> {
  if (pem.toUpperCase().includes('PRIVATE')) {
    throw new ResultBundleApiError(
      'RESULT_BUNDLE_KEY_PRIVATE_REJECTED',
      RESULT_BUNDLE_ERROR_MESSAGES.RESULT_BUNDLE_KEY_PRIVATE_REJECTED,
      400,
    );
  }

  const clean = pem.replace(/-----[^\n]+-----/g, '').replace(/\s+/g, '');
  if (!clean) {
    throw new ResultBundleApiError(
      'RESULT_BUNDLE_KEY_INVALID',
      RESULT_BUNDLE_ERROR_MESSAGES.RESULT_BUNDLE_KEY_INVALID,
      400,
    );
  }

  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw new ResultBundleApiError(
      'RESULT_BUNDLE_KEY_INVALID',
      RESULT_BUNDLE_ERROR_MESSAGES.RESULT_BUNDLE_KEY_INVALID,
      400,
    );
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const subtle = window.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API is not available');
  }

  const digest = await subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    let code = 'NETWORK_ERROR';
    let message = 'Yêu cầu thất bại';
    try {
      const data = await res.json();
      if (data?.error?.code) code = data.error.code;
      if (data?.error?.message) message = data.error.message;
    } catch {
      // Non-JSON response
    }
    throw new ResultBundleApiError(code, translateResultBundleError(code, message), res.status);
  }

  const json = await res.json();
  return json?.data ?? json;
}

export async function listResultBundleKeys(): Promise<readonly ResultBundleKeyItem[]> {
  return request<readonly ResultBundleKeyItem[]>('/api/v1/admin/result-bundles/keys');
}

export async function allowlistResultBundleKey(data: AllowlistKeyRequest): Promise<ResultBundleKeyItem> {
  return request<ResultBundleKeyItem>('/api/v1/admin/result-bundles/keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function revokeResultBundleKey(
  keyId: string,
  reason: string,
): Promise<{ keyId: string; revokedAt: string }> {
  return request<{ keyId: string; revokedAt: string }>(
    `/api/v1/admin/result-bundles/keys/${encodeURIComponent(keyId)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function dryRunResultBundle(bundle: unknown): Promise<DryRunResponse> {
  return request<DryRunResponse>('/api/v1/admin/result-bundles?dryRun=true', {
    method: 'POST',
    body: JSON.stringify(bundle),
  });
}

export async function publishResultBundle(bundle: unknown): Promise<PublishResponse> {
  return request<PublishResponse>('/api/v1/admin/result-bundles', {
    method: 'POST',
    body: JSON.stringify(bundle),
  });
}
