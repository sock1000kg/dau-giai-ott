import { useState, type ChangeEvent } from 'react';
import { Alert, Button } from '../../ui/index.ts';
import { Panel } from './shared.tsx';
import {
  dryRunResultBundle,
  publishResultBundle,
  translateResultBundleError,
  type DryRunResponse,
  type PublishResponse,
} from './resultBundleApi.ts';

const MAX_FILE_BYTES = 257 * 1024 * 1024;
const LARGE_FILE_THRESHOLD_BYTES = 20 * 1024 * 1024;

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('File read error'));
    reader.readAsText(file);
  });
}

export function ResultBundleImportSection({ onDone }: Readonly<{ onDone?: () => void }>) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bundleData, setBundleData] = useState<unknown | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResponse | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setVerifyError(null);
    setPublishError(null);
    setDryRunResult(null);
    setPublishResult(null);
    setSizeWarning(null);

    if (!file) {
      setSelectedFile(null);
      setBundleData(null);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setVerifyError('Kích thước tệp vượt quá giới hạn tối đa cho phép của hệ thống (257 MB).');
      setSelectedFile(null);
      setBundleData(null);
      return;
    }

    if (file.size > LARGE_FILE_THRESHOLD_BYTES) {
      setSizeWarning(
        `Cảnh báo: Tệp có kích thước lớn (${(file.size / (1024 * 1024)).toFixed(1)} MB). Quá trình xử lý có thể mất vài giây.`,
      );
    }

    setSelectedFile(file);
    setVerifying(true);

    try {
      const text = await readFileText(file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setVerifyError('Tệp không đúng định dạng JSON.');
        setVerifying(false);
        return;
      }

      setBundleData(parsed);

      // Perform dry-run verification
      const dryRun = await dryRunResultBundle(parsed);
      setDryRunResult(dryRun);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        setVerifyError(translateResultBundleError((err as { code: string }).code, err.message));
      } else {
        setVerifyError(err instanceof Error ? err.message : 'Xác minh bundle thất bại');
      }
    } finally {
      setVerifying(false);
    }
  }

  async function handlePublish() {
    if (!bundleData || !dryRunResult?.valid) return;

    setPublishing(true);
    setPublishError(null);

    try {
      const result = await publishResultBundle(bundleData);
      setPublishResult(result);
      onDone?.();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        setPublishError(translateResultBundleError((err as { code: string }).code, err.message));
      } else {
        setPublishError(err instanceof Error ? err.message : 'Công bố bundle thất bại');
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Panel
      id="result-bundle-import"
      title="Nhập ResultBundle"
      description="Nhập gói kết quả thi đấu đã ký số Ed25519 từ máy chủ offline. Hệ thống tự động xác minh tính toàn vẹn và khóa ký trước khi công bố."
    >
      {/* File picker */}
      <div className="ui-stack">
        <label htmlFor="bundle-file-input" style={{ fontWeight: 600 }}>
          Chọn tệp gói dữ liệu ResultBundle (.json)
        </label>
        <input
          id="bundle-file-input"
          type="file"
          accept=".json,application/json"
          onChange={(e) => void handleFileChange(e)}
          disabled={verifying || publishing}
        />
        {selectedFile && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
            Tệp đã chọn: <code>{selectedFile.name}</code> ({(selectedFile.size / 1024).toFixed(1)} KB)
          </p>
        )}
      </div>

      {sizeWarning && <Alert tone="warning">{sizeWarning}</Alert>}

      {verifying && (
        <Alert tone="info">
          Đang kiểm tra và xác minh chữ ký số của gói bundle…
        </Alert>
      )}

      {verifyError && (
        <Alert tone="danger">
          <strong>Từ chối bundle: </strong>
          {verifyError}
        </Alert>
      )}

      {/* Dry-run preview card */}
      {dryRunResult && dryRunResult.valid && (
        <div
          role="region"
          aria-label="Xem trước thông tin ResultBundle"
          className="ui-stack"
          style={{
            background: '#092518',
            border: '1px solid #14532d',
            padding: '16px',
            borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: '#4ade80' }}>Kết quả kiểm tra trước: HỢP LỆ</h3>
            <span className="ui-badge ui-badge--success">SẴN SÀNG CÔNG BỐ</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '13px' }}>
            <div>
              <span style={{ color: '#94a3b8' }}>Mã Bundle:</span>
              <div>
                <strong>{dryRunResult.bundleId}</strong>
              </div>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Phiên bản:</span>
              <div>
                <strong>v{dryRunResult.bundleVersion}</strong>
              </div>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Khóa ký:</span>
              <div>
                <code>{dryRunResult.keyId}</code>
              </div>
            </div>
            <div>
              <span style={{ color: '#94a3b8' }}>Số tệp đính kèm:</span>
              <div>
                <strong>{dryRunResult.artifacts} tệp</strong>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={{ color: '#94a3b8' }}>Vân tay khóa xác nhận (SHA-256):</span>
              <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#38bdf8', wordBreak: 'break-all' }}>
                {dryRunResult.fingerprint}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '8px' }}>
            <Button
              variant="primary"
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishing || Boolean(publishResult)}
            >
              {publishing ? 'Đang công bố…' : 'Công bố ResultBundle'}
            </Button>
          </div>
        </div>
      )}

      {publishError && (
        <Alert tone="danger">
          <strong>Lỗi công bố: </strong>
          {publishError}
        </Alert>
      )}

      {/* Result banner after publication */}
      {publishResult && (
        <div
          role="status"
          className="ui-stack"
          style={{
            background: '#042f2e',
            border: '1px solid #0d9488',
            padding: '16px',
            borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="ui-badge ui-badge--success" style={{ fontSize: '14px', padding: '4px 8px' }}>
              VERIFIED
            </span>
            <h3 style={{ margin: 0, color: '#2dd4bf' }}>
              {publishResult.replayed ? 'Bundle đã được xác nhận (đã công bố từ trước)' : 'Công bố ResultBundle thành công!'}
            </h3>
          </div>
          <p style={{ margin: '4px 0', fontSize: '13px', color: '#ccfbf1' }}>
            Toàn bộ nhánh đấu, tỷ số trận đấu và spectator replay đã được cập nhật chính thức vào hệ thống.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', fontSize: '12px' }}>
            <div>
              <span style={{ color: '#99f6e4' }}>Mã Bundle: </span>
              <strong>{publishResult.bundleId}</strong> (v{publishResult.bundleVersion})
            </div>
            <div>
              <span style={{ color: '#99f6e4' }}>Khóa ký: </span>
              <code>{publishResult.keyId}</code>
            </div>
            <div>
              <span style={{ color: '#99f6e4' }}>Thời điểm: </span>
              <span>{publishResult.importedAt}</span>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={{ color: '#99f6e4' }}>Mã SHA-256 Manifest: </span>
              <code style={{ fontSize: '11px' }}>{publishResult.manifestSha256}</code>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
