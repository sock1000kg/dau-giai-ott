import { describe, expect, it } from 'vitest';
import { cancellationLabel, formatVnDate, reasonLabel, statusLabel } from './labels.ts';
import { KNOWN_STAGES, stageOptions } from './stages.ts';

describe('result labels', () => {
  it('labels every known code and falls back to the raw code', () => {
    expect(['FINALIZED', 'FAILED', 'CANCELLED'].map(statusLabel)).toEqual(['Đã chốt', 'Lỗi hạ tầng', 'Đã hủy']);
    expect(['REACHED_GOAL', 'ELIMINATED_ALL_PIECES', 'TURN_LIMIT', 'FORFEIT'].map(reasonLabel)).toEqual(['Chạm đích', 'Loại hết quân', 'Hết giới hạn lượt', 'Bỏ cuộc']);
    expect(['MATCH_CANCELLED', 'INFRASTRUCTURE_FAILURE'].map(cancellationLabel)).toEqual(['Trận bị hủy', 'Lỗi hạ tầng']);
    expect([statusLabel('RUNNING'), reasonLabel('WEIRD'), cancellationLabel('toString')]).toEqual(['RUNNING', 'WEIRD', 'toString']);
  });

  it('formats dates in Vietnam time and null as a dash', () => {
    expect(formatVnDate('2026-10-18T17:30:00Z')).toBe('00:30 19/10/2026');
    expect(formatVnDate(null)).toBe('—');
    expect(formatVnDate('not-a-date')).toBe('—');
  });
});

describe('stage options', () => {
  it('lists known stages first, then unknown ones sorted, without duplicates', () => {
    expect(stageOptions([]).map((o) => o.value)).toEqual(['QUALIFICATION', 'FINALS']);
    expect(stageOptions(['ZED', 'FINALS', 'ALPHA', 'ZED', '']).map((o) => o.value)).toEqual([...KNOWN_STAGES.map((s) => s.value), 'ALPHA', 'ZED']);
    expect(stageOptions(['ALPHA']).at(-1)).toEqual({ value: 'ALPHA', label: 'ALPHA' });
  });
});
