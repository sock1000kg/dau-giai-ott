import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, PROTOCOL_VERSION_V2, type InitMessageV2 } from '../src/messages.ts';
import {
  compileProtocolValidator,
  utf8ByteLength,
  validateBotMessage,
  validateBotMessageV2,
  validateTimeControlV2,
  type BotMessageInput,
  type IncomingExpectation,
  type TimeControlErrorCode,
  type ValidateOptions,
  type ValidationErrorCodeV2,
} from '../src/index.ts';

// The canonical schemas and fixtures are the single source of truth: read them from
// docs/contracts/ instead of keeping a second copy inside the module (P1-L04 rule).
const contractsDir = new URL('../../../docs/contracts/', import.meta.url);

function readNdjson(name: string): string[] {
  return readFileSync(new URL(`fixtures/${name}`, contractsDir), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

const v1Schema = JSON.parse(readFileSync(new URL('bot-protocol-v1.schema.json', contractsDir), 'utf8')) as {
  $defs: Record<string, unknown>;
};
const v2Schema = JSON.parse(readFileSync(new URL('bot-protocol-v2.schema.json', contractsDir), 'utf8')) as {
  $defs: Record<string, unknown>;
};
const v1ValidLines = readNdjson('bot-protocol-v1-valid.ndjson');
const v2ValidLines = readNdjson('bot-protocol-v2-valid.ndjson');

interface GeneratedRawLine {
  readonly baseMessageType: string;
  readonly appendField: string;
  readonly repeatCharacter: string;
  readonly targetUtf8Bytes: number;
}

interface V2InvalidCase {
  readonly name: string;
  readonly inputKind: 'rawLine' | 'message' | 'generatedRawLine';
  readonly rawLine?: string;
  readonly message?: unknown;
  readonly generator?: GeneratedRawLine;
  readonly expectedError: ValidationErrorCodeV2;
}

const invalidCases = (
  JSON.parse(readFileSync(new URL('fixtures/bot-protocol-v2-invalid-cases.json', contractsDir), 'utf8')) as {
    cases: V2InvalidCase[];
  }
).cases;

const v1Validator = compileProtocolValidator(v1Schema);
const v2Validator = compileProtocolValidator(v2Schema);
const MAX_MESSAGE_BYTES = 65536;
const EXPECT: IncomingExpectation = {
  matchId: 'm-fixture-001',
  turnId: 17,
  legalActions: [{ pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } }],
};

function options(validator: ReturnType<typeof compileProtocolValidator>): ValidateOptions {
  return { validator, maxMessageBytes: MAX_MESSAGE_BYTES, expect: EXPECT };
}

const v1Options = (): ValidateOptions => options(v1Validator);
const v2Options = (): ValidateOptions => options(v2Validator);

function generateOversizedLine(generator: GeneratedRawLine): string {
  const base = {
    type: generator.baseMessageType,
    protocolVersion: 2,
    matchId: EXPECT.matchId,
    turnId: EXPECT.turnId,
    action: { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } },
    [generator.appendField]: '',
  };
  const skeletonBytes = utf8ByteLength(JSON.stringify(base));
  const padding = generator.targetUtf8Bytes - skeletonBytes + 1;
  return JSON.stringify({ ...base, [generator.appendField]: generator.repeatCharacter.repeat(padding) });
}

function inputFor(testCase: V2InvalidCase): BotMessageInput {
  if (testCase.inputKind === 'rawLine') {
    return { kind: 'line', line: testCase.rawLine ?? '' };
  }
  if (testCase.inputKind === 'message') {
    return { kind: 'value', value: testCase.message };
  }
  if (testCase.generator === undefined) {
    throw new Error(`invalid case ${testCase.name} has no generator`);
  }
  return { kind: 'line', line: generateOversizedLine(testCase.generator) };
}

type MutableSchema = { $defs: Record<string, Record<string, unknown>> };

function cloneSchema(): MutableSchema {
  return JSON.parse(JSON.stringify(v2Schema)) as MutableSchema;
}

function patchedValidator(mutate: (schema: MutableSchema) => void) {
  const schema = cloneSchema();
  mutate(schema);
  return compileProtocolValidator(schema);
}

function v2Init(): Record<string, unknown> {
  return JSON.parse(v2ValidLines[0] ?? '{}') as Record<string, unknown>;
}

function v2StateUpdate(): Record<string, unknown> {
  return JSON.parse(v2ValidLines[1] ?? '{}') as Record<string, unknown>;
}

describe('P3-L01 v2 schema: canonical transcripts', () => {
  it('accepts the five v2 fixture lines in lifecycle order', () => {
    expect(v2ValidLines).toHaveLength(5);
    const types = v2ValidLines.map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types).toEqual(['INIT', 'STATE_UPDATE', 'ACTION', 'TURN_RESULT', 'MATCH_RESULT']);
    for (const line of v2ValidLines) {
      const result = validateBotMessageV2({ kind: 'line', line }, v2Options());
      expect(result.ok, line.slice(0, 48)).toBe(true);
    }
  });

  it('rejects every v1 fixture line with the v2 validator (no silent downgrade)', () => {
    expect(v1ValidLines).toHaveLength(5);
    for (const line of v1ValidLines) {
      const result = validateBotMessageV2({ kind: 'line', line }, v2Options());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('SCHEMA_VIOLATION');
    }
  });

  it('rejects every v2 fixture line with the v1 validator (no silent upgrade)', () => {
    for (const line of v2ValidLines) {
      const result = validateBotMessage({ kind: 'line', line }, v1Options());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('SCHEMA_VIOLATION');
    }
  });

  it('fails closed when the v2 entry point is handed the v1 validator', () => {
    const line = v1ValidLines[2] ?? '';
    expect(line.length).toBeGreaterThan(0);
    const result = validateBotMessageV2({ kind: 'line', line }, v1Options());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_VIOLATION');
  });

  it('keeps the exported v2 INIT type aligned with the fixture', () => {
    const init = v2Init() as unknown as InitMessageV2;
    expect(init.protocolVersion).toBe(PROTOCOL_VERSION_V2);
    expect(typeof init.botSeed).toBe('string');
    expect(init.limits.timeControl.perTurn.mode).toBe('DYNAMIC');
  });
});

describe('P3-L01 v2 schema: invalid-case matrix from the fixture', () => {
  for (const testCase of invalidCases) {
    it(`rejects ${testCase.name} with ${testCase.expectedError}`, () => {
      const result = validateBotMessageV2(inputFor(testCase), v2Options());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(testCase.expectedError);
    });
  }

  it('builds an oversized line above the byte limit for the generated case', () => {
    const generated = invalidCases.find((testCase) => testCase.inputKind === 'generatedRawLine');
    expect(generated?.generator).toBeDefined();
    if (generated?.generator === undefined) return;
    expect(utf8ByteLength(generateOversizedLine(generated.generator))).toBeGreaterThan(MAX_MESSAGE_BYTES);
  });
});

describe('P3-L01 v2 schema: schema/type consistency', () => {
  const messageDefs = ['initMessage', 'stateUpdateMessage', 'actionMessage', 'turnResultMessage', 'matchResultMessage'];

  it('declares exactly the five protocol message types, pinned to version 2', () => {
    const defs = v2Schema.$defs as Record<string, { properties?: Record<string, unknown> }>;
    const consts = messageDefs.map(
      (name) => (defs[name]?.properties?.['type'] as { const?: string } | undefined)?.const,
    );
    expect(consts).toEqual(['INIT', 'STATE_UPDATE', 'ACTION', 'TURN_RESULT', 'MATCH_RESULT']);
    for (const name of messageDefs) {
      expect(defs[name]?.properties?.['protocolVersion']).toEqual({ $ref: '#/$defs/protocolVersionV2' });
    }
    expect(v2Schema.$defs.protocolVersionV2).toEqual({ const: 2 });
  });

  it('keeps protocol version constants frozen: v1 = 1, v2 = 2', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(PROTOCOL_VERSION_V2).toBe(2);
  });

  it('keeps every shared $defs entry identical to the v1 schema (no drift)', () => {
    const shared = [
      'matchId',
      'pieceId',
      'sha256',
      'side',
      'pieceType',
      'position',
      'piece',
      'gameAction',
      'mapRef',
      'mapDefinition',
      'publicGameState',
      'turnErrorCode',
      'faultCode',
      'faultSummary',
    ];
    for (const name of shared) {
      expect(v2Schema.$defs[name], name).toEqual(v1Schema.$defs[name]);
    }
  });

  it('replaces the v1 timeout fields with limits.timeControl', () => {
    const limitsV2 = v2Schema.$defs.limitsV2 as {
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(limitsV2.additionalProperties).toBe(false);
    expect(limitsV2.required).toContain('timeControl');
    expect(Object.keys(limitsV2.properties)).not.toContain('turnTimeoutMs');
    expect(Object.keys(limitsV2.properties)).not.toContain('startupTimeoutMs');
  });
});

describe('P3-L01 v2 schema: private per-bot seed', () => {
  it('requires botSeed and never accepts seed or engineSeed', () => {
    const initDef = v2Schema.$defs.initMessage as { required: string[]; properties: Record<string, unknown> };
    expect(initDef.required).toContain('botSeed');
    expect(Object.keys(initDef.properties)).not.toContain('seed');
    expect(Object.keys(initDef.properties)).not.toContain('engineSeed');
  });

  it('mirrors the v1 seed constraints for botSeed (no invented constraint)', () => {
    const v1Seed = (v1Schema.$defs.initMessage as { properties: Record<string, unknown> }).properties['seed'];
    const v2BotSeed = (v2Schema.$defs.initMessage as { properties: Record<string, unknown> }).properties['botSeed'];
    expect(v2BotSeed).toEqual(v1Seed);
  });

  it('uses a botSeed that differs from the v1 fixture seed', () => {
    const v1Init = JSON.parse(v1ValidLines[0] ?? '{}') as { seed?: string };
    const init = v2Init() as { botSeed?: string };
    expect(typeof init.botSeed).toBe('string');
    expect(init.botSeed).not.toBe(v1Init.seed);
  });

  it('rejects an INIT that also leaks engineSeed', () => {
    const v1Init = JSON.parse(v1ValidLines[0] ?? '{}') as { seed?: string };
    const leaked = { ...v2Init(), engineSeed: v1Init.seed };
    const result = validateBotMessageV2({ kind: 'value', value: leaked }, v2Options());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_VIOLATION');
  });
});

describe('P3-L01 v2 schema: time budget semantics', () => {
  it('accepts the approved qualification default time control', () => {
    expect(
      validateTimeControlV2({
        totalBotBudgetMs: 60000,
        perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
      }).ok,
    ).toBe(true);
  });

  const rejected: readonly (readonly [unknown, TimeControlErrorCode])[] = [
    [
      { totalBotBudgetMs: 60000, perTurn: { mode: 'DYNAMIC', baseMs: 4000, stepMs: 500, everyTurns: 40, maxMs: 3000 } },
      'BASE_EXCEEDS_MAX',
    ],
    [
      { totalBotBudgetMs: 60000, perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 70000 } },
      'MAX_EXCEEDS_TOTAL_BUDGET',
    ],
    [{ totalBotBudgetMs: 60000, perTurn: { mode: 'ADAPTIVE', baseMs: 1000 } }, 'INVALID_MODE'],
    [{ totalBotBudgetMs: 60000, perTurn: 'none' }, 'INVALID_MODE'],
    [null, 'INVALID_MODE'],
    [
      { totalBotBudgetMs: 60000, perTurn: { mode: 'DYNAMIC', baseMs: '1000', stepMs: 500, everyTurns: 40, maxMs: 3000 } },
      'INVALID_BUDGET',
    ],
  ];

  for (const [input, code] of rejected) {
    it(`rejects an invalid time control with ${code}`, () => {
      const result = validateTimeControlV2(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(code);
    });
  }

  it('accepts FIXED and NONE policies that have no per-turn numeric relation', () => {
    expect(validateTimeControlV2({ totalBotBudgetMs: 60000, perTurn: { mode: 'FIXED', fixedMs: 30000 } }).ok).toBe(
      true,
    );
    expect(validateTimeControlV2({ totalBotBudgetMs: 60000, perTurn: { mode: 'NONE' } }).ok).toBe(true);
  });

  it('applies the numeric relations end to end through an INIT message', () => {
    const message = v2Init();
    (message['limits'] as { timeControl: unknown }).timeControl = {
      startupMs: 5000,
      totalBotBudgetMs: 60000,
      matchWallClockMs: 150000,
      perTurn: { mode: 'DYNAMIC', baseMs: 4000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
    };
    const result = validateBotMessageV2({ kind: 'value', value: message }, v2Options());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BASE_EXCEEDS_MAX');
  });
});

describe('P3-L01 v2 schema: per-turn budget in STATE_UPDATE', () => {
  function withBudget(timeBudget: unknown): Record<string, unknown> {
    const message = v2StateUpdate();
    message['timeBudget'] = timeBudget;
    return message;
  }

  it('accepts a null per-turn cap with a finite remaining budget', () => {
    const result = validateBotMessageV2(
      { kind: 'value', value: withBudget({ turnLimitMs: null, remainingBotBudgetMs: 0 }) },
      v2Options(),
    );
    expect(result.ok).toBe(true);
  });

  const rejectedBudget: readonly (readonly [Record<string, number>, ValidationErrorCodeV2])[] = [
    [{ turnLimitMs: 0, remainingBotBudgetMs: 59000 }, 'SCHEMA_VIOLATION'],
    [{ turnLimitMs: 1000, remainingBotBudgetMs: -1 }, 'SCHEMA_VIOLATION'],
  ];

  for (const [timeBudget, code] of rejectedBudget) {
    it(`rejects ${JSON.stringify(timeBudget)} with ${code}`, () => {
      const result = validateBotMessageV2({ kind: 'value', value: withBudget(timeBudget) }, v2Options());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(code);
    });
  }

  it('rejects a STATE_UPDATE that drops timeBudget entirely', () => {
    const message = v2StateUpdate();
    delete message['timeBudget'];
    const result = validateBotMessageV2({ kind: 'value', value: message }, v2Options());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_VIOLATION');
  });
});

describe('P3-L01 v2 schema: mutation evidence', () => {
  it('mutation: relaxing the version pin lets the v1 ACTION fixture pass the mutated schema', () => {
    const validator = patchedValidator((schema) => {
      (schema.$defs['protocolVersionV2'] as unknown as { const: number }).const = 1;
    });
    const line = v1ValidLines[2] ?? '';
    const result = validateBotMessage(
      { kind: 'line', line },
      { validator, maxMessageBytes: MAX_MESSAGE_BYTES, expect: EXPECT },
    );
    expect(result.ok).toBe(true);
  });

  it('mutation: dropping the botSeed requirement lets the v1 seed fixture pass the mutated schema', () => {
    const validator = patchedValidator((schema) => {
      const init = schema.$defs['initMessage'] as unknown as {
        required: string[];
        properties: Record<string, unknown>;
      };
      init.required = init.required.filter((field) => field !== 'botSeed');
      init.properties['seed'] = { type: 'string', minLength: 1, maxLength: 128 };
    });
    const testCase = invalidCases.find((candidate) => candidate.name === 'init-v1-seed-field');
    expect(testCase).toBeDefined();
    if (testCase === undefined) return;
    const result = validateBotMessageV2(
      inputFor(testCase),
      { validator, maxMessageBytes: MAX_MESSAGE_BYTES, expect: EXPECT },
    );
    expect(result.ok).toBe(true);
  });

  it('mutation: flipping a valid v2 fixture line to protocolVersion 1 is rejected', () => {
    const action = JSON.parse(v2ValidLines[2] ?? '{}') as Record<string, unknown>;
    action['protocolVersion'] = 1;
    const result = validateBotMessageV2({ kind: 'value', value: action }, v2Options());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_VIOLATION');
  });
});
