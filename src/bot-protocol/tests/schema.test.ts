import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  compileProtocolValidator,
  utf8ByteLength,
  validateBotMessage,
  type BotMessageInput,
  type IncomingExpectation,
  type ValidationErrorCode,
  type ValidateOptions,
} from '../src/index.ts';

// The canonical schema and fixtures are the single source of truth: read them from
// docs/contracts/ instead of keeping a second copy inside the module.
const contractsDir = new URL('../../../docs/contracts/', import.meta.url);
const schema = JSON.parse(readFileSync(new URL('bot-protocol-v1.schema.json', contractsDir), 'utf8')) as unknown;
const validLines = readFileSync(new URL('fixtures/bot-protocol-v1-valid.ndjson', contractsDir), 'utf8')
  .split('\n')
  .filter((line) => line.length > 0);

interface GeneratedRawLine {
  readonly baseMessageType: string;
  readonly appendField: string;
  readonly repeatCharacter: string;
  readonly targetUtf8Bytes: number;
}

interface InvalidCase {
  readonly name: string;
  readonly inputKind: 'rawLine' | 'message' | 'generatedRawLine';
  readonly rawLine?: string;
  readonly message?: unknown;
  readonly generator?: GeneratedRawLine;
  readonly expectedError: ValidationErrorCode;
}

const invalidCases = (
  JSON.parse(readFileSync(new URL('fixtures/bot-protocol-v1-invalid-cases.json', contractsDir), 'utf8')) as {
    cases: InvalidCase[];
  }
).cases;

const validator = compileProtocolValidator(schema);
const MAX_MESSAGE_BYTES = 65536;
const EXPECT: IncomingExpectation = {
  matchId: 'm-fixture-001',
  turnId: 17,
  legalActions: [{ pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } }],
};

function options(): ValidateOptions {
  return { validator, maxMessageBytes: MAX_MESSAGE_BYTES, expect: EXPECT };
}

function generateOversizedLine(generator: GeneratedRawLine): string {
  const base = {
    type: generator.baseMessageType,
    protocolVersion: 1,
    matchId: EXPECT.matchId,
    turnId: EXPECT.turnId,
    action: { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } },
    [generator.appendField]: '',
  };
  const skeletonBytes = utf8ByteLength(JSON.stringify(base));
  const padding = generator.targetUtf8Bytes - skeletonBytes + 1;
  return JSON.stringify({ ...base, [generator.appendField]: generator.repeatCharacter.repeat(padding) });
}

function inputFor(testCase: InvalidCase): BotMessageInput {
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

describe('P1-L04 validator: canonical valid transcript', () => {
  it('accepts all five lines in order', () => {
    expect(validLines).toHaveLength(5);
    const types = validLines.map((line) => (JSON.parse(line) as { type: string }).type);
    expect(types).toEqual(['INIT', 'STATE_UPDATE', 'ACTION', 'TURN_RESULT', 'MATCH_RESULT']);
    for (const line of validLines) {
      const result = validateBotMessage({ kind: 'line', line }, options());
      expect(result.ok, line.slice(0, 48)).toBe(true);
    }
  });
});

describe('P1-L04 validator: invalid-case matrix', () => {
  for (const testCase of invalidCases) {
    it(`rejects ${testCase.name} with ${testCase.expectedError}`, () => {
      const result = validateBotMessage(inputFor(testCase), options());
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

describe('P1-L04 validator: schema/type consistency', () => {
  it('schema declares exactly the five protocol message types', () => {
    const defs = (schema as { $defs: Record<string, { properties?: { type?: { const?: string } } }> }).$defs;
    const consts = [
      'initMessage',
      'stateUpdateMessage',
      'actionMessage',
      'turnResultMessage',
      'matchResultMessage',
    ].map((name) => defs[name]?.properties?.type?.const);
    expect(consts).toEqual(['INIT', 'STATE_UPDATE', 'ACTION', 'TURN_RESULT', 'MATCH_RESULT']);
  });
});
