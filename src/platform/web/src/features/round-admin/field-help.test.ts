import { describe, expect, it } from 'vitest';
import { FIELD_HELP, fieldIdFromDomId } from './field-help.ts';

describe('FIELD_HELP', () => {
  it('has a non-empty one-line entry for every key', () => {
    for (const [key, text] of Object.entries(FIELD_HELP)) {
      expect(text.length, key).toBeGreaterThan(10);
      expect(text, key).not.toContain('\n');
    }
  });

  it('maps DOM ids to field ids', () => {
    expect(fieldIdFromDomId('rr-startupMs')).toBe('startupMs');
    expect(fieldIdFromDomId('rr-mapId-3')).toBe('mapId');
  });
});
