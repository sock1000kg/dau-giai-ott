import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FAULT_CODES, PROCESS_FAULT_CODES, TURN_ERROR_CODES } from '../src/errors.ts';
import { DEFAULT_LIMITS, PROTOCOL_VERSION } from '../src/messages.ts';

interface SchemaDefs {
  readonly $defs: Record<string, { readonly enum?: string[]; readonly required?: string[] }>;
}

const schema = JSON.parse(
  readFileSync(new URL('../../../docs/contracts/bot-protocol-v1.schema.json', import.meta.url), 'utf8'),
) as SchemaDefs;

describe('P1-L03 protocol types: schema cross-check', () => {
  it('freezes protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('TurnErrorCode matches $defs.turnErrorCode.enum', () => {
    expect([...TURN_ERROR_CODES]).toEqual(schema.$defs.turnErrorCode?.enum);
  });

  it('FaultCode matches $defs.faultCode.enum', () => {
    expect([...FAULT_CODES]).toEqual(schema.$defs.faultCode?.enum);
  });

  it('keeps process faults inside faultCode and out of NO_LEGAL_ACTION', () => {
    for (const code of PROCESS_FAULT_CODES) {
      expect(FAULT_CODES).toContain(code);
    }
    expect(FAULT_CODES).not.toContain('NO_LEGAL_ACTION');
  });

  it('DEFAULT_LIMITS keys match $defs.limits.required', () => {
    const required = [...(schema.$defs.limits?.required ?? [])].sort();
    expect(Object.keys(DEFAULT_LIMITS).sort()).toEqual(required);
  });

  it('DEFAULT_LIMITS matches the Phase 1 runtime baseline', () => {
    expect(DEFAULT_LIMITS).toEqual({
      startupTimeoutMs: 5000,
      turnTimeoutMs: 3000,
      maxTurns: 200,
      maxMessageBytes: 65536,
      maxStderrBytes: 1048576,
      maxConsecutiveFaults: 3,
      maxTotalFaults: 5,
    });
  });
});
