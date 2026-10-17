import { isIP } from 'node:net';

export type DeploymentMode = 'dev' | 'test' | 'hosted' | 'production';

export interface Cidr {
  readonly raw: string;
  readonly version: 4 | 6;
  readonly prefix: number;
  matches(ip: string): boolean;
}

export interface SecurityConfig {
  readonly mode: DeploymentMode;
  readonly totpRequired: boolean;
  readonly adminAllowlist: readonly Cidr[];     // empty = allow all (dev/test only)
  readonly trustedProxies: readonly Cidr[];     // explicit; [] = no proxy, use socket address
  readonly totpEncryptionKey: Buffer | null;    // 32 bytes, AES-256-GCM; required whenever TOTP is enabled
  readonly writeRateLimit: { readonly perIpPerMinute: number; readonly perAccountPerMinute: number };
  readonly trustedProxiesConfigured?: boolean;
}

export function normalizeIp(ip: string): string {
  let trimmed = ip.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    trimmed = trimmed.slice(1, -1);
  }
  // IPv4-mapped IPv6 check: ::ffff:a.b.c.d
  if (trimmed.toLowerCase().startsWith('::ffff:')) {
    const rest = trimmed.slice(7);
    if (isIP(rest) === 4) {
      return rest;
    }
  }
  return trimmed;
}

export function isValidIp(ip: string): boolean {
  const norm = normalizeIp(ip);
  return isIP(norm) !== 0;
}

function parseIPv4ToNumber(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const part = Number(parts[i]);
    if (!Number.isInteger(part) || part < 0 || part > 255) {
      throw new Error(`Invalid IPv4 octet in: ${ip}`);
    }
    num = ((num << 8) | part) >>> 0;
  }
  return num;
}

function parseIPv6ToBigInt(ip: string): bigint {
  const norm = normalizeIp(ip);
  if (isIP(norm) !== 6) throw new Error(`Invalid IPv6 address: ${ip}`);

  const parts = norm.split('::');
  if (parts.length > 2) throw new Error(`Multiple '::' in IPv6: ${ip}`);

  let leftBlocks: string[] = [];
  let rightBlocks: string[] = [];

  if (parts[0] && parts[0].length > 0) {
    leftBlocks = parts[0].split(':');
  }
  if (parts.length === 2 && parts[1] && parts[1].length > 0) {
    rightBlocks = parts[1].split(':');
  }

  const missingBlocks = 8 - (leftBlocks.length + rightBlocks.length);
  if (parts.length === 1 && missingBlocks !== 0) {
    throw new Error(`Incomplete IPv6 address: ${ip}`);
  }
  if (missingBlocks < 0) {
    throw new Error(`Too many blocks in IPv6 address: ${ip}`);
  }

  const allBlocks: number[] = [];
  for (const b of leftBlocks) {
    const val = parseInt(b, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) throw new Error(`Invalid IPv6 block: ${b}`);
    allBlocks.push(val);
  }
  for (let i = 0; i < missingBlocks; i++) {
    allBlocks.push(0);
  }
  for (const b of rightBlocks) {
    const val = parseInt(b, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) throw new Error(`Invalid IPv6 block: ${b}`);
    allBlocks.push(val);
  }

  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 16n) | BigInt(allBlocks[i]!);
  }
  return result;
}

export function parseCidr(rawCidr: string): Cidr {
  const trimmed = rawCidr.trim();
  const slashIdx = trimmed.indexOf('/');
  const ipPart = slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
  const prefixPart = slashIdx === -1 ? null : trimmed.slice(slashIdx + 1);

  const normalizedIp = normalizeIp(ipPart);
  const ipVersion = isIP(normalizedIp);
  if (ipVersion === 0) {
    throw new Error(`Invalid IP address in CIDR: ${rawCidr}`);
  }

  if (ipVersion === 4) {
    const prefix = prefixPart === null ? 32 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`Invalid IPv4 CIDR prefix in: ${rawCidr}`);
    }
    const ipNum = parseIPv4ToNumber(normalizedIp);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const network = (ipNum & mask) >>> 0;

    return {
      raw: trimmed,
      version: 4,
      prefix,
      matches(targetIp: string): boolean {
        const normTarget = normalizeIp(targetIp);
        if (isIP(normTarget) !== 4) return false;
        try {
          const targetNum = parseIPv4ToNumber(normTarget);
          return ((targetNum & mask) >>> 0) === network;
        } catch {
          return false;
        }
      },
    };
  } else {
    const prefix = prefixPart === null ? 128 : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      throw new Error(`Invalid IPv6 CIDR prefix in: ${rawCidr}`);
    }
    const ipBigInt = parseIPv6ToBigInt(normalizedIp);
    const mask = prefix === 0
      ? 0n
      : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
    const network = ipBigInt & mask;

    return {
      raw: trimmed,
      version: 6,
      prefix,
      matches(targetIp: string): boolean {
        const normTarget = normalizeIp(targetIp);
        if (isIP(normTarget) !== 6) return false;
        try {
          const targetBigInt = parseIPv6ToBigInt(normTarget);
          return (targetBigInt & mask) === network;
        } catch {
          return false;
        }
      },
    };
  }
}

export function isAmbiguousCidr(cidr: Cidr): boolean {
  if (cidr.version === 4 && cidr.prefix === 0) return true;
  if (cidr.version === 6 && cidr.prefix === 0) return true;
  return false;
}

export function isIpInAllowlist(ip: string, allowlist: readonly Cidr[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = normalizeIp(ip);
  return allowlist.some((cidr) => cidr.matches(normalized));
}

export function effectiveClientIp(
  socketAddress: string,
  xForwardedFor: string | string[] | undefined,
  trustedProxies: readonly Cidr[],
): string {
  const normalizedSocket = normalizeIp(socketAddress);
  const isSocketTrusted = trustedProxies.some((proxy) => proxy.matches(normalizedSocket));

  // If socket address is not a trusted proxy, ignore XFF completely (spoofing defense)
  if (!isSocketTrusted) {
    return normalizedSocket;
  }

  // Socket is a trusted proxy. Inspect X-Forwarded-For:
  if (xForwardedFor === undefined) {
    return normalizedSocket;
  }
  const rawHeader = Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : xForwardedFor;
  const entries = rawHeader.split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    return normalizedSocket;
  }

  // Walk right-to-left
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    const normalizedEntry = normalizeIp(entry);
    if (!isValidIp(normalizedEntry)) {
      // Malformed entries → treat as untrusted stop / reject
      return normalizedEntry;
    }
    const isTrusted = trustedProxies.some((proxy) => proxy.matches(normalizedEntry));
    if (!isTrusted) {
      return normalizedEntry;
    }
  }

  // If all entries in XFF were trusted proxies, return the leftmost one
  return normalizeIp(entries[0]!);
}

export function loadSecurityConfig(env: Readonly<Record<string, string | undefined>> = process.env): SecurityConfig {
  const modeRaw = env.OTT_DEPLOYMENT_MODE;
  if (!modeRaw || !['dev', 'test', 'hosted', 'production'].includes(modeRaw)) {
    throw new Error(`Invalid or missing OTT_DEPLOYMENT_MODE: '${modeRaw}'. Must be 'dev', 'test', 'hosted', or 'production'.`);
  }
  const mode = modeRaw as DeploymentMode;

  const totpRaw = env.OTT_ADMIN_TOTP_REQUIRED;
  let totpRequired = false;
  if (totpRaw !== undefined && totpRaw !== '') {
    if (totpRaw === 'true') {
      totpRequired = true;
    } else if (totpRaw === 'false') {
      totpRequired = false;
    } else {
      throw new Error(`Invalid OTT_ADMIN_TOTP_REQUIRED: '${totpRaw}'. Must be 'true' or 'false'.`);
    }
  }

  const allowlistRaw = env.OTT_ADMIN_ALLOWLIST;
  const adminAllowlist = (allowlistRaw === undefined || allowlistRaw.trim() === '')
    ? []
    : allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean).map(parseCidr);

  const proxiesRaw = env.OTT_TRUSTED_PROXIES;
  let trustedProxiesConfigured = true;
  let trustedProxies: readonly Cidr[] = [];
  if (proxiesRaw === undefined) {
    trustedProxiesConfigured = false;
    trustedProxies = [];
  } else if (proxiesRaw.trim() === '' || proxiesRaw.trim().toLowerCase() === 'none') {
    trustedProxiesConfigured = true;
    trustedProxies = [];
  } else {
    trustedProxiesConfigured = true;
    trustedProxies = proxiesRaw.split(',').map((s) => s.trim()).filter(Boolean).map(parseCidr);
  }

  const keyRaw = env.OTT_TOTP_ENCRYPTION_KEY;
  let totpEncryptionKey: Buffer | null = null;
  if (keyRaw !== undefined && keyRaw.trim() !== '') {
    try {
      const buf = Buffer.from(keyRaw.trim(), 'base64');
      if (buf.length !== 32) {
        throw new Error(`OTT_TOTP_ENCRYPTION_KEY must be exactly 32 bytes (decoded length is ${buf.length})`);
      }
      totpEncryptionKey = buf;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('OTT_TOTP_ENCRYPTION_KEY')) {
        throw err;
      }
      throw new Error(`Invalid base64 in OTT_TOTP_ENCRYPTION_KEY: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ipLimitRaw = env.OTT_WRITE_RATE_LIMIT_IP;
  const acctLimitRaw = env.OTT_WRITE_RATE_LIMIT_ACCOUNT;
  const perIpPerMinute = ipLimitRaw !== undefined ? Number(ipLimitRaw) : 600;
  const perAccountPerMinute = acctLimitRaw !== undefined ? Number(acctLimitRaw) : 300;

  if (!Number.isInteger(perIpPerMinute) || perIpPerMinute <= 0) {
    throw new Error(`Invalid OTT_WRITE_RATE_LIMIT_IP: '${ipLimitRaw}'. Must be a positive integer.`);
  }
  if (!Number.isInteger(perAccountPerMinute) || perAccountPerMinute <= 0) {
    throw new Error(`Invalid OTT_WRITE_RATE_LIMIT_ACCOUNT: '${acctLimitRaw}'. Must be a positive integer.`);
  }

  return {
    mode,
    totpRequired,
    adminAllowlist,
    trustedProxies,
    totpEncryptionKey,
    writeRateLimit: { perIpPerMinute, perAccountPerMinute },
    trustedProxiesConfigured,
  };
}

export function devSecurityConfig(): SecurityConfig {
  return {
    mode: 'dev',
    totpRequired: false,
    adminAllowlist: [],
    trustedProxies: [],
    totpEncryptionKey: null,
    writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
    trustedProxiesConfigured: true,
  };
}

export function assertSecurityConfig(config: SecurityConfig): void {
  // Validate encryption key length if provided
  if (config.totpEncryptionKey !== null && config.totpEncryptionKey.length !== 32) {
    throw new Error('TOTP encryption key must be exactly 32 bytes');
  }

  // Validate rate limit values
  if (!Number.isInteger(config.writeRateLimit.perIpPerMinute) || config.writeRateLimit.perIpPerMinute <= 0) {
    throw new Error('Invalid writeRateLimit.perIpPerMinute: must be a positive integer');
  }
  if (!Number.isInteger(config.writeRateLimit.perAccountPerMinute) || config.writeRateLimit.perAccountPerMinute <= 0) {
    throw new Error('Invalid writeRateLimit.perAccountPerMinute: must be a positive integer');
  }

  // Whenever TOTP is required/enabled, encryption key is required
  if (config.totpRequired && config.totpEncryptionKey === null && (config.mode === 'dev' || config.mode === 'test')) {
    throw new Error('TOTP encryption key is required whenever TOTP is enabled');
  }

  // Hosted / Production startup guard (AC-23)
  if (config.mode === 'hosted' || config.mode === 'production') {
    const violations: string[] = [];

    if (!config.totpRequired) {
      violations.push('TOTP must be required (OTT_ADMIN_TOTP_REQUIRED=true)');
    }
    if (config.adminAllowlist.length === 0) {
      violations.push('Admin network allowlist must not be empty (OTT_ADMIN_ALLOWLIST)');
    }
    if (config.trustedProxiesConfigured === false) {
      violations.push('Trusted proxies configuration is unset (OTT_TRUSTED_PROXIES must be set or literal "none")');
    } else if (config.trustedProxies.some((p) => isAmbiguousCidr(p))) {
      violations.push('Trusted proxies configuration is ambiguous (cannot contain 0.0.0.0/0 or ::/0)');
    }
    if (config.totpEncryptionKey === null || config.totpEncryptionKey.length !== 32) {
      violations.push('TOTP encryption key is missing or invalid (OTT_TOTP_ENCRYPTION_KEY must be 32 bytes base64)');
    }

    if (violations.length > 0) {
      throw new Error(
        `Hosted startup guard failed for ${config.mode} mode:\n` +
        violations.map((v) => ` - ${v}`).join('\n'),
      );
    }
  }
}
