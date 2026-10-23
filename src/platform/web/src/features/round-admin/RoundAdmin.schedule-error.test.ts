import { describe, expect, it } from 'vitest';
import { mapServerPathToField, serverCodeMessage } from './RoundRuleForm.tsx';

describe('round rule form schedule errors (loop 87)', () => {
  it('maps the whole-schedule path to a visible field', () => {
    expect(mapServerPathToField('schedule')).toBe('submissionOpensAt');
  });

  it('explains ORDER_VIOLATION in Vietnamese', () => {
    expect(serverCodeMessage('ORDER_VIOLATION')).toBe(
      'Thứ tự thời gian phải là: mở nộp < hạn nộp < hết ân hạn ≤ bắt đầu chạy < hết khiếu nại.',
    );
  });

  it('explains INVALID_ISO8601 and falls back for unknown codes', () => {
    expect(serverCodeMessage('INVALID_ISO8601')).toMatch(/ISO 8601/);
    expect(serverCodeMessage('SOMETHING_NEW')).toBe('Máy chủ từ chối: SOMETHING_NEW.');
  });
});
