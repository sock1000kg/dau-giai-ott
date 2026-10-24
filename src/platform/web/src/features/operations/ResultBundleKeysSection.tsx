import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Textarea } from '../../ui/index.ts';
import { formatTime, Panel } from './shared.tsx';
import {
  allowlistResultBundleKey,
  computeClientFingerprint,
  listResultBundleKeys,
  revokeResultBundleKey,
  translateResultBundleError,
  type ResultBundleKeyItem,
} from './resultBundleApi.ts';

export function ResultBundleKeysSection({ refreshToken }: Readonly<{ refreshToken?: number }>) {
  const [keys, setKeys] = useState<readonly ResultBundleKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyId, setKeyId] = useState('');
  const [publicKeyPem, setPublicKeyPem] = useState('');
  const [fingerprintConfirmation, setFingerprintConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [clientFingerprint, setClientFingerprint] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Revocation dialog state
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    async function load() {
      try {
        const items = await listResultBundleKeys();
        if (isMounted.current) setKeys(items);
      } catch {
        // Ignored on initial load error
      } finally {
        if (isMounted.current) setLoading(false);
      }
    }
    void load();
    return () => {
      isMounted.current = false;
    };
  }, [refreshToken]);

  // Live client-side fingerprint preview
  useEffect(() => {
    let active = true;
    const rawPem = publicKeyPem.trim();
    if (!rawPem) {
      setClientFingerprint(null);
      setPreviewError(null);
      return;
    }

    if (rawPem.toUpperCase().includes('PRIVATE')) {
      setClientFingerprint(null);
      setPreviewError('Khóa riêng (PRIVATE KEY) không được phép nhập vào hệ thống.');
      return;
    }

    computeClientFingerprint(rawPem)
      .then((fp) => {
        if (active) {
          setClientFingerprint(fp);
          setPreviewError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setClientFingerprint(null);
          setPreviewError(err instanceof Error ? err.message : 'Định dạng khóa không hợp lệ');
        }
      });

    return () => {
      active = false;
    };
  }, [publicKeyPem]);

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Enforce private key check before sending
    if (publicKeyPem.toUpperCase().includes('PRIVATE')) {
      setError('Khóa riêng (PRIVATE KEY) không được phép nhập vào hệ thống.');
      return;
    }

    if (!keyId.trim() || !publicKeyPem.trim() || !fingerprintConfirmation.trim() || !reason.trim()) {
      setError('Vui lòng điền đầy đủ các thông tin bắt buộc.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await allowlistResultBundleKey({
        keyId: keyId.trim(),
        publicKeyPem: publicKeyPem.trim(),
        fingerprintConfirmation: fingerprintConfirmation.trim(),
        reason: reason.trim(),
      });

      setSuccessMessage(`Đăng ký khóa ${created.keyId} thành công! Vân tay: ${created.fingerprint}`);
      setKeyId('');
      setPublicKeyPem('');
      setFingerprintConfirmation('');
      setReason('');
      setClientFingerprint(null);

      // Refresh list
      const updated = await listResultBundleKeys();
      setKeys(updated);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        setError(translateResultBundleError((err as { code: string }).code, err.message));
      } else {
        setError(err instanceof Error ? err.message : 'Đăng ký khóa thất bại');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeConfirm() {
    if (!revokingKeyId) return;
    if (!revokeReason.trim()) {
      setRevokeError('Lý do thu hồi là bắt buộc (1-500 ký tự).');
      return;
    }

    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeResultBundleKey(revokingKeyId, revokeReason.trim());
      setSuccessMessage(`Đã thu hồi khóa ${revokingKeyId}.`);
      setRevokingKeyId(null);
      setRevokeReason('');

      // Refresh list
      const updated = await listResultBundleKeys();
      setKeys(updated);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        setRevokeError(translateResultBundleError((err as { code: string }).code, err.message));
      } else {
        setRevokeError(err instanceof Error ? err.message : 'Thu hồi khóa thất bại');
      }
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Panel
      id="result-bundle-keys"
      title="Khóa công khai ResultBundle"
      description="Đăng ký và quản lý các khóa công khai Ed25519 dùng để xác minh kết quả vòng chung kết (ResultBundle). Khóa không bao giờ bị xóa hoặc ghi đè."
    >
      {error && (
        <Alert tone="danger">
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert tone="success">
          {successMessage}
        </Alert>
      )}

      {/* Keys Table */}
      <div className="ui-table-scroll">
        <table className="ui-table" aria-label="Danh sách khóa ResultBundle">
          <caption>Danh sách khóa Ed25519 đã đăng ký</caption>
          <thead>
            <tr>
              <th scope="col">Mã khóa (keyId)</th>
              <th scope="col">Vân tay SHA-256 (SPKI DER)</th>
              <th scope="col">Thời điểm đăng ký</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Số bundle</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center' }}>
                  Đang tải danh sách khóa…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center' }}>
                  Chưa có khóa công khai nào được đăng ký
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.keyId}>
                  <td>
                    <code>{k.keyId}</code>
                  </td>
                  <td>
                    <code style={{ fontSize: '11px' }}>{k.fingerprint}</code>
                  </td>
                  <td>{formatTime(k.allowlistedAt)}</td>
                  <td>
                    {k.revokedAt === null ? (
                      <span className="ui-badge ui-badge--success">Hoạt động</span>
                    ) : (
                      <span className="ui-badge ui-badge--danger" title={`Thu hồi lúc: ${formatTime(k.revokedAt)}`}>
                        Đã thu hồi
                      </span>
                    )}
                  </td>
                  <td>{k.bundleCount}</td>
                  <td>
                    {k.revokedAt === null && (
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() => {
                          setRevokingKeyId(k.keyId);
                          setRevokeReason('');
                          setRevokeError(null);
                        }}
                      >
                        Thu hồi
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Revocation Confirm Dialog */}
      {revokingKeyId && (
        <div
          role="group"
          aria-labelledby="revoke-confirm-title"
          className="ui-stack"
          style={{ background: '#2a1215', border: '1px solid #7f1d1d', padding: '16px', borderRadius: '8px' }}
        >
          <h3 id="revoke-confirm-title" style={{ color: '#f87171', margin: 0 }}>
            Xác nhận thu hồi khóa: <code>{revokingKeyId}</code>
          </h3>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Khóa sau khi thu hồi sẽ <strong>vĩnh viễn không thể khôi phục</strong>. Mọi ResultBundle ký bằng khóa này sau
            đó sẽ bị từ chối công bố.
          </p>
          {revokeError && <Alert tone="danger">{revokeError}</Alert>}
          <Field label="Lý do thu hồi (bắt buộc, tối đa 500 ký tự)">
            <Textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Ví dụ: USB chứa khóa riêng bị thất lạc hoặc lộ bí mật"
              maxLength={500}
              required
            />
          </Field>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="danger" type="button" onClick={() => void handleRevokeConfirm()} disabled={revoking}>
              {revoking ? 'Đang thu hồi…' : 'Xác nhận thu hồi khóa'}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setRevokingKeyId(null)} disabled={revoking}>
              Hủy
            </Button>
          </div>
        </div>
      )}

      {/* Registration Form */}
      <form onSubmit={(e) => void handleRegister(e)} className="ui-stack">
        <h3 style={{ margin: '12px 0 4px 0' }}>Đăng ký khóa công khai mới</h3>
        <Field label="Mã nhận diện khóa (keyId)">
          <Input
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder="Ví dụ: finals-lan-2026-key1"
            maxLength={128}
            required
          />
        </Field>

        <Field label="Khóa công khai Ed25519 (định dạng SPKI PEM)">
          <Textarea
            value={publicKeyPem}
            onChange={(e) => setPublicKeyPem(e.target.value)}
            placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
            rows={5}
            required
          />
        </Field>

        {previewError && <Alert tone="danger">{previewError}</Alert>}

        {clientFingerprint && (
          <div
            style={{
              padding: '8px 12px',
              background: '#0d2538',
              border: '1px solid #1e4976',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            <strong>Vân tay tính toán từ khóa (SHA-256 SPKI):</strong>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: '4px', color: '#38bdf8' }}>
              {clientFingerprint}
            </div>
          </div>
        )}

        <Field label="Nhập lại vân tay xác nhận (đọc từ màn hình máy offline)">
          <Input
            value={fingerprintConfirmation}
            onChange={(e) => setFingerprintConfirmation(e.target.value)}
            placeholder="Nhập 64 ký tự hex (có thể có dấu hai chấm hoặc khoảng trắng)"
            required
          />
        </Field>

        <Field label="Lý do đăng ký khóa (tối đa 500 ký tự)">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ví dụ: Khóa chính thức do Key Custodian cấp tại lễ sinh khóa offline"
            maxLength={500}
            required
          />
        </Field>

        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? 'Đang đăng ký…' : 'Đăng ký khóa'}
        </Button>
      </form>
    </Panel>
  );
}
