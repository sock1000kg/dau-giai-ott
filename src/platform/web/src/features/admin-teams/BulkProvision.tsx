import { useState, type ChangeEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Table } from '../../ui/index.ts';
import { bulkImportTeams, isTeamApiError, type ApiRowError } from './api.ts';
import './admin-teams.css';

export interface BulkProvisionProps {
  readonly onImportSuccess: () => Promise<void> | void;
}

export function downloadCredentialBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function rowErrorMessage(error: ApiRowError): string {
  switch (error.code) {
    case 'CSV_EMPTY':
      return 'Tệp CSV không có dữ liệu.';
    case 'CSV_HEADER_INVALID':
      return 'Dòng tiêu đề không hợp lệ (yêu cầu: team_name,representative_email).';
    case 'CSV_TOO_MANY_ROWS':
      return 'Tệp CSV vượt quá giới hạn 500 đội.';
    case 'ROW_FIELD_COUNT':
      return 'Số cột không đúng (phải có đúng 2 cột).';
    case 'TEAM_NAME_INVALID':
      return 'Tên đội không hợp lệ (1-100 ký tự, không chứa ký tự điều khiển).';
    case 'EMAIL_INVALID':
      return 'Email người đại diện không hợp lệ.';
    case 'DUPLICATE_TEAM_NAME':
      return error.relatedRow
        ? `Tên đội bị trùng với dòng ${error.relatedRow}.`
        : 'Tên đội bị trùng lặp trong tệp.';
    case 'DUPLICATE_EMAIL':
      return error.relatedRow
        ? `Email bị trùng với dòng ${error.relatedRow}.`
        : 'Email người đại diện bị trùng lặp trong tệp.';
    case 'TEAM_NAME_TAKEN':
      return 'Tên đội đã tồn tại trên hệ thống.';
    case 'EMAIL_TAKEN':
      return 'Email người đại diện đã được sử dụng.';
    default:
      return 'Dữ liệu không hợp lệ.';
  }
}

export function BulkProvision({ onImportSuccess }: BulkProvisionProps) {
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<readonly ApiRowError[]>([]);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setActionError(null);
    setRowErrors([]);
    setSuccessNotice(null);
  }

  async function handleImport() {
    if (!file) return;
    setWorking(true);
    setActionError(null);
    setRowErrors([]);
    setSuccessNotice(null);

    try {
      const csvText = await readFileText(file);
      const { blob, filename } = await bulkImportTeams(csvText);
      downloadCredentialBlob(blob, filename);

      setSuccessNotice(`Đã tải file ${filename} — xóa file sau khi gửi`);
      setFile(null);
      setInputKey((current) => current + 1);
      await onImportSuccess();
    } catch (error) {
      if (isTeamApiError(error)) {
        if (error.status === 403) {
          setActionError('Tài khoản không có quyền quản lý đội thi.');
        } else if (error.errors && error.errors.length > 0) {
          setActionError('Tệp CSV có dữ liệu không hợp lệ. Vui lòng kiểm tra lại bảng lỗi bên dưới.');
          setRowErrors(error.errors);
        } else {
          setActionError('Không thể nhập danh sách đội. Vui lòng kiểm tra lại dữ liệu.');
        }
      } else {
        setActionError('Không thể hoàn tất thao tác. Vui lòng thử lại.');
      }
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card title="Cấp tài khoản hàng loạt (CSV)">
      <div className="teams-import">
        <p>
          Tải lên danh sách đội thi định dạng CSV. File mật khẩu sẽ chỉ tải được đúng một lần sau khi nhập.
        </p>

        {successNotice !== null && <Alert tone="success">{successNotice}</Alert>}
        {actionError !== null && <Alert tone="danger">{actionError}</Alert>}

        {rowErrors.length > 0 && (
          <Table
            caption="Bảng lỗi CSV"
            columns={[
              { key: 'row', header: 'Dòng', render: (err) => (err.row === 0 ? 'Toàn tệp' : err.row) },
              { key: 'column', header: 'Cột', render: (err) => err.column ?? '—' },
              { key: 'code', header: 'Mã lỗi', render: (err) => <Badge>{err.code}</Badge> },
              { key: 'detail', header: 'Chi tiết', render: (err) => rowErrorMessage(err) },
            ]}
            rows={rowErrors}
            rowKey={(err) => `${err.row}-${err.column ?? 'row'}-${err.code}-${rowErrors.indexOf(err)}`}
            emptyMessage="Không có lỗi."
          />
        )}

        <Field
          label="Tải lên danh sách đội (.csv)"
          help="Dòng tiêu đề: team_name,representative_email. Đúng 2 cột, tối đa 500 đội, tên đội 1-100 ký tự."
        >
          <Input
            key={inputKey}
            type="file"
            accept=".csv,text/csv"
            disabled={working}
            onChange={handleFileChange}
          />
        </Field>
        <Button disabled={working || file === null} onClick={() => void handleImport()}>
          {working ? 'Đang nhập…' : 'Nhập danh sách'}
        </Button>
      </div>
    </Card>
  );
}
