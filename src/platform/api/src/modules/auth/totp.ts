import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

/**
 * Encodes a buffer to RFC 4648 Base32 (no padding).
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decodes an RFC 4648 Base32 string (case-insensitive, ignores spaces/hyphens).
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]!;
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates a 160-bit (20 bytes) random Base32 secret for TOTP.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Computes the HOTP/TOTP code for a given 64-bit step counter and raw secret bytes.
 * Implements RFC 4226 / RFC 6238 HMAC-SHA1.
 */
export function generateHotpCode(secretBytes: Buffer, counter: bigint, digits: number = TOTP_DIGITS): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter, 0);

  const hmac = createHmac('sha1', secretBytes);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  const offset = hash[hash.length - 1]! & 0x0f;
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Computes TOTP code for a Base32 secret at a given Unix timestamp in seconds.
 */
export function generateTotpCode(
  secretBase32: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
  digits: number = TOTP_DIGITS,
): string {
  const secretBytes = base32Decode(secretBase32);
  const step = BigInt(Math.floor(timestampSeconds / TOTP_STEP_SECONDS));
  return generateHotpCode(secretBytes, step, digits);
}

export interface VerifyTotpResult {
  readonly valid: boolean;
  readonly step?: bigint;
}

/**
 * Verifies a TOTP code against a Base32 secret within ±window steps (default window = 1).
 * Uses constant-time comparison.
 */
export function verifyTotp(
  code: string,
  secretBase32: string,
  options?: { timestampSeconds?: number; window?: number; digits?: number },
): VerifyTotpResult {
  const digits = options?.digits ?? TOTP_DIGITS;
  const trimmed = code.trim();
  if (trimmed.length !== digits || !/^\d+$/.test(trimmed)) {
    return { valid: false };
  }

  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secretBase32);
  } catch {
    return { valid: false };
  }

  const timestamp = options?.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const currentStep = BigInt(Math.floor(timestamp / TOTP_STEP_SECONDS));
  const window = options?.window ?? 1;

  const targetBuf = Buffer.from(trimmed);

  for (let offset = -window; offset <= window; offset++) {
    const candidateStep = currentStep + BigInt(offset);
    if (candidateStep < 0n) continue;

    const expected = generateHotpCode(secretBytes, candidateStep, digits);
    const expectedBuf = Buffer.from(expected);

    if (targetBuf.length === expectedBuf.length && timingSafeEqual(targetBuf, expectedBuf)) {
      return { valid: true, step: candidateStep };
    }
  }

  return { valid: false };
}

/**
 * Builds an otpauth:// URI for authenticator applications.
 */
export function buildOtpAuthUri(options: {
  accountName: string;
  secret: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = options.issuer ?? 'OTT Arena';
  const digits = options.digits ?? TOTP_DIGITS;
  const period = options.period ?? TOTP_STEP_SECONDS;

  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(options.accountName)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer,
    algorithm: 'SHA1',
    digits: digits.toString(),
    period: period.toString(),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Normalizes a recovery code (removes dashes/spaces, uppercase).
 */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Computes SHA-256 hash of normalized recovery code.
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/**
 * Generates 10 recovery codes: 80-bit random each, formatted as XXXX-XXXX-XXXX-XXXX.
 */
export function generateRecoveryCodes(count: number = 10): { formatted: string[]; hashes: string[] } {
  const formatted: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(10)).slice(0, 16);
    const pretty = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
    formatted.push(pretty);
    hashes.push(hashRecoveryCode(pretty));
  }

  return { formatted, hashes };
}

export interface EncryptedTotpSecret {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly keyVersion: number;
}

/**
 * Encrypts a TOTP secret using AES-256-GCM with a 32-byte key.
 */
export function encryptTotpSecret(secret: string, key: Buffer, keyVersion: number = 1): EncryptedTotpSecret {
  if (key.length !== 32) {
    throw new Error('TOTP encryption key must be exactly 32 bytes');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { ciphertext, iv, tag, keyVersion };
}

/**
 * Decrypts a TOTP secret using AES-256-GCM.
 */
export function decryptTotpSecret(
  encrypted: { ciphertext: Buffer; iv: Buffer; tag: Buffer },
  key: Buffer,
): string {
  if (key.length !== 32) {
    throw new Error('TOTP encryption key must be exactly 32 bytes');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.iv);
  decipher.setAuthTag(encrypted.tag);
  const decrypted = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
