import { describe, expect, it } from 'vitest';
import {
  formatCredentialsCsv,
  generateCredential,
  parseCsvRows,
  validateCsv,
} from '../src/modules/teams/bulk.ts';

describe('pure CSV parser and validator (bulk-teams)', () => {
  it('parses valid CSV with CRLF and optional UTF-8 BOM', () => {
    const csv = '\uFEFFteam_name,representative_email\r\nTeam Alpha,alpha@example.com\r\nTeam Beta,beta@example.com\r\n';
    const result = validateCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.rows).toEqual([
      { teamName: 'Team Alpha', representativeEmail: 'alpha@example.com' },
      { teamName: 'Team Beta', representativeEmail: 'beta@example.com' },
    ]);
  });

  it('handles LF line endings and trailing empty lines', () => {
    const csv = 'team_name,representative_email\nTeam One,one@example.com\nTeam Two,two@example.com\n\n';
    const result = validateCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.rows).toHaveLength(2);
  });

  it('handles RFC 4180 quotes with escaped quotes and commas in validateCsv', () => {
    const csv = 'team_name,representative_email\n"Team ""Super"" One","one,first@example.com"\n"Team Three",three@example.com\n';
    const result = validateCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.rows[0]!.teamName).toBe('Team "Super" One');
    expect(result.rows[0]!.representativeEmail).toBe('one,first@example.com');
    expect(result.rows[1]!.teamName).toBe('Team Three');
    expect(result.rows[1]!.representativeEmail).toBe('three@example.com');
  });

  it('parseCsvRows handles RFC 4180 multiline quoted fields', () => {
    const csv = 'col1,col2\n"Line 1\nLine 2",simple\n';
    const rows = parseCsvRows(csv);
    expect(rows).toEqual([
      ['col1', 'col2'],
      ['Line 1\nLine 2', 'simple'],
    ]);
  });

  it('accepts case-insensitive and trimmed header row', () => {
    const csv = ' TEAM_NAME , Representative_Email \nTeam A,a@example.com\n';
    const result = validateCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.rows).toHaveLength(1);
  });

  it('rejects invalid or missing header with CSV_HEADER_INVALID', () => {
    const csv1 = 'team_name\nTeam A\n';
    expect(validateCsv(csv1)).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_HEADER_INVALID' }],
    });

    const csv2 = 'team_name,email\nTeam A,a@example.com\n';
    expect(validateCsv(csv2)).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_HEADER_INVALID' }],
    });

    const csv3 = 'team_name,representative_email,extra\nTeam A,a@example.com,foo\n';
    expect(validateCsv(csv3)).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_HEADER_INVALID' }],
    });
  });

  it('rejects empty input or zero data rows with CSV_EMPTY', () => {
    expect(validateCsv('')).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_EMPTY' }],
    });

    expect(validateCsv('team_name,representative_email\n')).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_EMPTY' }],
    });

    expect(validateCsv('team_name,representative_email\n\r\n  \n')).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_EMPTY' }],
    });
  });

  it('rejects more than 500 rows with CSV_TOO_MANY_ROWS', () => {
    const rows = ['team_name,representative_email'];
    for (let i = 1; i <= 501; i += 1) {
      rows.push(`Team ${i},team${i}@example.com`);
    }
    const result = validateCsv(rows.join('\n'));
    expect(result).toEqual({
      ok: false,
      errors: [{ row: 0, code: 'CSV_TOO_MANY_ROWS' }],
    });
  });

  it('accepts exactly 500 data rows', () => {
    const rows = ['team_name,representative_email'];
    for (let i = 1; i <= 500; i += 1) {
      rows.push(`Team ${i},team${i}@example.com`);
    }
    const result = validateCsv(rows.join('\n'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.rows).toHaveLength(500);
  });

  it('reports ROW_FIELD_COUNT when a row does not have 2 fields', () => {
    const csv = 'team_name,representative_email\nTeam Alpha\nTeam Beta,beta@example.com,extra\n';
    const result = validateCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected false');
    expect(result.errors).toContainEqual({ row: 1, code: 'ROW_FIELD_COUNT' });
    expect(result.errors).toContainEqual({ row: 2, code: 'ROW_FIELD_COUNT' });
  });

  it('validates team_name constraints and reports TEAM_NAME_INVALID', () => {
    const longName = 'A'.repeat(101);
    const controlName = 'Team\x00Bad';
    const emptyName = '   ';
    const csv = `team_name,representative_email\n${emptyName},a@example.com\n${longName},b@example.com\n${controlName},c@example.com\n`;

    const result = validateCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected false');
    expect(result.errors).toContainEqual({ row: 1, column: 'team_name', code: 'TEAM_NAME_INVALID' });
    expect(result.errors).toContainEqual({ row: 2, column: 'team_name', code: 'TEAM_NAME_INVALID' });
    expect(result.errors).toContainEqual({ row: 3, column: 'team_name', code: 'TEAM_NAME_INVALID' });
  });

  it('validates representative_email constraints and reports EMAIL_INVALID', () => {
    const longEmail = `${'a'.repeat(250)}@example.com`;
    const noDomain = 'plainaddress';
    const noUser = '@example.com';
    const controlEmail = 'bad\x07@example.com';
    const csv = `team_name,representative_email\nTeam 1,${longEmail}\nTeam 2,${noDomain}\nTeam 3,${noUser}\nTeam 4,${controlEmail}\n`;

    const result = validateCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected false');
    expect(result.errors).toContainEqual({ row: 1, column: 'representative_email', code: 'EMAIL_INVALID' });
    expect(result.errors).toContainEqual({ row: 2, column: 'representative_email', code: 'EMAIL_INVALID' });
    expect(result.errors).toContainEqual({ row: 3, column: 'representative_email', code: 'EMAIL_INVALID' });
    expect(result.errors).toContainEqual({ row: 4, column: 'representative_email', code: 'EMAIL_INVALID' });
  });

  it('detects duplicate team names and emails in file with relatedRow', () => {
    const csv = [
      'team_name,representative_email',
      'Team Alpha,alpha@example.com', // row 1
      'Team Beta,beta@example.com',   // row 2
      'TEAM ALPHA,different@example.com', // row 3: dup name of row 1
      'Team Gamma,ALPHA@EXAMPLE.COM',     // row 4: dup email of row 1
    ].join('\n');

    const result = validateCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected false');
    expect(result.errors).toContainEqual({
      row: 3,
      column: 'team_name',
      code: 'DUPLICATE_TEAM_NAME',
      relatedRow: 1,
    });
    expect(result.errors).toContainEqual({
      row: 4,
      column: 'representative_email',
      code: 'DUPLICATE_EMAIL',
      relatedRow: 1,
    });
  });

  it('collects all errors and never echoes cell values in error objects', () => {
    const csv = [
      'team_name,representative_email',
      ',', // row 1: both empty
      'Team Valid,valid@example.com', // row 2: ok
      'Team Valid,valid@example.com', // row 3: both duplicate
    ].join('\n');

    const result = validateCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected false');
    expect(result.errors.length).toBeGreaterThanOrEqual(4);

    // Verify error objects do not echo cell values
    for (const err of result.errors) {
      expect(Object.keys(err)).toEqual(expect.arrayContaining(['row', 'code']));
      expect(err).not.toHaveProperty('value');
      expect(err).not.toHaveProperty('cell');
      expect(JSON.stringify(err)).not.toContain('Team Valid');
      expect(JSON.stringify(err)).not.toContain('valid@example.com');
    }
  });

  it('formats output credentials CSV with formula/injection safety and RFC 4180 escaping', () => {
    const rows = [
      {
        teamName: '=cmd|/C calc',
        representativeEmail: '+user@example.com',
        username: '-admin',
        password: '@secret"pass',
      },
      {
        teamName: 'Regular Team',
        representativeEmail: null,
        username: 'user\ttab',
        password: 'pass,comma',
      },
    ];

    const output = formatCredentialsCsv(rows);

    // Check BOM
    expect(output.charCodeAt(0)).toBe(0xfeff);
    // Header
    expect(output).toContain('team_name,representative_email,username,password\r\n');

    // Injection escaping with leading single quote:
    // =cmd -> '=cmd
    expect(output).toContain("'=cmd|/C calc");
    // +user -> '+user
    expect(output).toContain("'+user@example.com");
    // -admin -> '-admin
    expect(output).toContain("'-admin");
    // @secret"pass -> leading quote for formula, plus quotes around cell for embedded quote
    expect(output).toContain('"\'@secret""pass"');

    // Null email should be empty string
    expect(output).toContain('Regular Team,,');
    // Embedded comma should be quoted
    expect(output).toContain('"pass,comma"');
  });

  it('generates random credentials with expected length and format', () => {
    const cred = generateCredential('Đội Tuyển Thi Đấu #1');
    expect(cred.username).toMatch(/^[a-z0-9-]+$/);
    expect(cred.password).toHaveLength(32);
  });
});
