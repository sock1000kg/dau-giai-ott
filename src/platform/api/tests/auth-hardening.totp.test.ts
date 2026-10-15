import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateHotpCode,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from '../src/modules/auth/totp.ts';

describe('auth-hardening TOTP & encryption (AC1)', () => {
  // RFC 6238 Appendix B SHA1 test vectors
  // Secret: ASCII "12345678901234567890" (20 bytes)
  const rfcSecretAscii = '12345678901234567890';
  const rfcSecretBytes = Buffer.from(rfcSecretAscii, 'ascii');
  const rfcSecretBase32 = base32Encode(rfcSecretBytes);

  it('matches RFC 6238 Appendix B test vectors for HMAC-SHA1', () => {
    const testVectors = [
      { time: 59, step: 1n, otp8: '94287082', otp6: '287082' },
      { time: 1111111109, step: 37037036n, otp8: '07081804', otp6: '081804' },
      { time: 1111111111, step: 37037037n, otp8: '14050471', otp6: '050471' },
      { time: 1234567890, step: 41152263n, otp8: '89005924', otp6: '005924' },
      { time: 2000000000, step: 66666666n, otp8: '69279037', otp6: '279037' },
      { time: 20000000000, step: 666666666n, otp8: '65353130', otp6: '353130' },
    ];

    for (const vector of testVectors) {
      const code8 = generateHotpCode(rfcSecretBytes, vector.step, 8);
      const code6 = generateHotpCode(rfcSecretBytes, vector.step, 6);
      expect(code8).toBe(vector.otp8);
      expect(code6).toBe(vector.otp6);

      const totp6 = generateTotpCode(rfcSecretBase32, vector.time, 6);
      expect(totp6).toBe(vector.otp6);
    }
  });

  describe('Base32 encoding and decoding', () => {
    it('round-trips arbitrary buffers', () => {
      const sample = Buffer.from('hello world from antigravity');
      const encoded = base32Encode(sample);
      const decoded = base32Decode(encoded);
      expect(decoded.toString('utf8')).toBe('hello world from antigravity');
    });

    it('ignores hyphens, spaces, and casing in Base32 input', () => {
      const sample = Buffer.from('test secret 12345');
      const encoded = base32Encode(sample);
      const formatted = `${encoded.slice(0, 4)}-${encoded.slice(4, 8)} ${encoded.slice(8).toLowerCase()}`;
      expect(base32Decode(formatted)).toEqual(sample);
    });
  });

  describe('TOTP verification and window', () => {
    const timestamp = 1234567890; // step = 41152263
    const currentCode = generateTotpCode(rfcSecretBase32, timestamp); // '005924'
    const prevCode = generateTotpCode(rfcSecretBase32, timestamp - 30); // step - 1
    const nextCode = generateTotpCode(rfcSecretBase32, timestamp + 30); // step + 1
    const farCode = generateTotpCode(rfcSecretBase32, timestamp + 60); // step + 2

    it('accepts current step code', () => {
      const result = verifyTotp(currentCode, rfcSecretBase32, { timestampSeconds: timestamp, window: 1 });
      expect(result.valid).toBe(true);
      expect(result.step).toBe(41152263n);
    });

    it('accepts previous step (within window=1)', () => {
      const result = verifyTotp(prevCode, rfcSecretBase32, { timestampSeconds: timestamp, window: 1 });
      expect(result.valid).toBe(true);
      expect(result.step).toBe(41152262n);
    });

    it('accepts next step (within window=1)', () => {
      const result = verifyTotp(nextCode, rfcSecretBase32, { timestampSeconds: timestamp, window: 1 });
      expect(result.valid).toBe(true);
      expect(result.step).toBe(41152264n);
    });

    it('rejects step outside window', () => {
      const result = verifyTotp(farCode, rfcSecretBase32, { timestampSeconds: timestamp, window: 1 });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid format codes', () => {
      expect(verifyTotp('12345', rfcSecretBase32, { timestampSeconds: timestamp }).valid).toBe(false);
      expect(verifyTotp('abcdef', rfcSecretBase32, { timestampSeconds: timestamp }).valid).toBe(false);
      expect(verifyTotp('1234567', rfcSecretBase32, { timestampSeconds: timestamp }).valid).toBe(false);
    });
  });

  describe('otpauth URI builder', () => {
    it('builds standard URI with issuer and secret', () => {
      const uri = buildOtpAuthUri({ accountName: 'admin@ott.vn', secret: rfcSecretBase32 });
      expect(uri).toContain('otpauth://totp/OTT%20Arena:admin%40ott.vn');
      expect(uri).toContain(`secret=${rfcSecretBase32}`);
      expect(uri).toContain('issuer=OTT+Arena');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });
  });

  describe('Recovery codes', () => {
    it('generates 10 formatted recovery codes with hashes', () => {
      const { formatted, hashes } = generateRecoveryCodes(10);
      expect(formatted.length).toBe(10);
      expect(hashes.length).toBe(10);

      for (let i = 0; i < 10; i++) {
        const code = formatted[i]!;
        expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        expect(hashes[i]).toBe(hashRecoveryCode(code));
      }
    });

    it('normalizes code with varying whitespace and case', () => {
      const code1 = 'ABCD-EFGH-IJKL-MNOP';
      const code2 = 'abcd efgh ijkl mnop';
      expect(normalizeRecoveryCode(code1)).toBe(normalizeRecoveryCode(code2));
      expect(hashRecoveryCode(code1)).toBe(hashRecoveryCode(code2));
    });
  });

  describe('AES-256-GCM encryption helpers', () => {
    const key = Buffer.alloc(32, 42);

    it('round-trips plaintext secret through encryption and decryption', () => {
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(secret, key, 1);

      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.iv.length).toBe(12);
      expect(encrypted.tag.length).toBe(16);
      expect(encrypted.keyVersion).toBe(1);

      const decrypted = decryptTotpSecret(encrypted, key);
      expect(decrypted).toBe(secret);
    });

    it('throws error when ciphertext is tampered', () => {
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(secret, key);
      const tamperedCipher = Buffer.from(encrypted.ciphertext);
      tamperedCipher[0] = (tamperedCipher[0]! ^ 0xff);

      expect(() =>
        decryptTotpSecret({ ...encrypted, ciphertext: tamperedCipher }, key),
      ).toThrow();
    });

    it('throws error when auth tag is tampered', () => {
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(secret, key);
      const tamperedTag = Buffer.from(encrypted.tag);
      tamperedTag[0] = (tamperedTag[0]! ^ 0xff);

      expect(() =>
        decryptTotpSecret({ ...encrypted, tag: tamperedTag }, key),
      ).toThrow();
    });

    it('throws error when decrypted with wrong key', () => {
      const secret = generateTotpSecret();
      const encrypted = encryptTotpSecret(secret, key);
      const wrongKey = Buffer.alloc(32, 99);

      expect(() => decryptTotpSecret(encrypted, wrongKey)).toThrow();
    });
  });
});
