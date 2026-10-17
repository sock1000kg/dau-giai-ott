import { describe, expect, it } from 'vitest';
import {
  assertSecurityConfig,
  devSecurityConfig,
  effectiveClientIp,
  loadSecurityConfig,
  normalizeIp,
  parseCidr,
  type SecurityConfig,
} from '../src/config/security.ts';

describe('auth-hardening security config & network boundary', () => {
  const validKey = Buffer.alloc(32, 1).toString('base64');

  describe('CIDR parsing and matching', () => {
    it('matches IPv4 single host and subnets', () => {
      const cidrSubnet = parseCidr('192.168.1.0/24');
      expect(cidrSubnet.matches('192.168.1.1')).toBe(true);
      expect(cidrSubnet.matches('192.168.1.254')).toBe(true);
      expect(cidrSubnet.matches('192.168.2.1')).toBe(false);

      const cidrSingle = parseCidr('10.0.0.5');
      expect(cidrSingle.matches('10.0.0.5')).toBe(true);
      expect(cidrSingle.matches('10.0.0.6')).toBe(false);
    });

    it('matches IPv6 addresses and subnets', () => {
      const cidr = parseCidr('2001:db8::/32');
      expect(cidr.matches('2001:db8::1')).toBe(true);
      expect(cidr.matches('2001:db8:ffff::1')).toBe(true);
      expect(cidr.matches('2001:db9::1')).toBe(false);

      const localhost6 = parseCidr('::1');
      expect(localhost6.matches('::1')).toBe(true);
      expect(localhost6.matches('::2')).toBe(false);
    });

    it('handles IPv4-mapped IPv6 addresses consistently', () => {
      const cidr = parseCidr('192.168.1.0/24');
      expect(cidr.matches('::ffff:192.168.1.42')).toBe(true);
      expect(cidr.matches('::ffff:10.0.0.1')).toBe(false);
      expect(normalizeIp('::ffff:192.168.1.42')).toBe('192.168.1.42');
    });

    it('rejects malformed CIDRs', () => {
      expect(() => parseCidr('invalid')).toThrow();
      expect(() => parseCidr('192.168.1.1/33')).toThrow();
      expect(() => parseCidr('2001:db8::/129')).toThrow();
      expect(() => parseCidr('256.0.0.1')).toThrow();
    });
  });

  describe('effectiveClientIp spoofing defense', () => {
    const trustedProxies = [parseCidr('10.0.0.0/8'), parseCidr('172.16.0.0/12')];

    it('ignores X-Forwarded-For if socket address is untrusted peer', () => {
      const client = effectiveClientIp('203.0.113.195', '192.168.1.50', trustedProxies);
      expect(client).toBe('203.0.113.195');
    });

    it('trusts X-Forwarded-For when socket address is a trusted proxy', () => {
      const client = effectiveClientIp('10.0.0.2', '192.168.1.50', trustedProxies);
      expect(client).toBe('192.168.1.50');
    });

    it('walks multi-hop X-Forwarded-For right-to-left and returns first untrusted hop', () => {
      // Chain: Client (198.51.100.5) -> Proxy1 (172.16.0.5) -> Proxy2 (10.0.0.3) -> App socket (10.0.0.2)
      const xff = '198.51.100.5, 172.16.0.5, 10.0.0.3';
      const client = effectiveClientIp('10.0.0.2', xff, trustedProxies);
      expect(client).toBe('198.51.100.5');
    });

    it('stops at malformed entry in XFF chain and treats as untrusted', () => {
      const xff = '198.51.100.5, invalid-ip, 10.0.0.3';
      const client = effectiveClientIp('10.0.0.2', xff, trustedProxies);
      expect(client).toBe('invalid-ip');
    });

    it('returns leftmost entry if all hops in XFF are trusted proxies', () => {
      const xff = '10.0.0.10, 10.0.0.20';
      const client = effectiveClientIp('10.0.0.2', xff, trustedProxies);
      expect(client).toBe('10.0.0.10');
    });

    it('returns socket address if XFF is empty or undefined', () => {
      expect(effectiveClientIp('10.0.0.2', undefined, trustedProxies)).toBe('10.0.0.2');
      expect(effectiveClientIp('10.0.0.2', '', trustedProxies)).toBe('10.0.0.2');
    });
  });

  describe('loadSecurityConfig', () => {
    it('throws if OTT_DEPLOYMENT_MODE is missing or unknown', () => {
      expect(() => loadSecurityConfig({})).toThrow(/OTT_DEPLOYMENT_MODE/);
      expect(() => loadSecurityConfig({ OTT_DEPLOYMENT_MODE: 'staging' })).toThrow(/OTT_DEPLOYMENT_MODE/);
    });

    it('loads dev mode defaults with empty allowlist and disabled TOTP', () => {
      const config = loadSecurityConfig({ OTT_DEPLOYMENT_MODE: 'dev' });
      expect(config.mode).toBe('dev');
      expect(config.totpRequired).toBe(false);
      expect(config.adminAllowlist).toEqual([]);
      expect(config.trustedProxies).toEqual([]);
      expect(config.totpEncryptionKey).toBeNull();
      expect(config.writeRateLimit).toEqual({ perIpPerMinute: 600, perAccountPerMinute: 300 });
    });

    it('parses hosted configuration with all variables set', () => {
      const config = loadSecurityConfig({
        OTT_DEPLOYMENT_MODE: 'hosted',
        OTT_ADMIN_TOTP_REQUIRED: 'true',
        OTT_ADMIN_ALLOWLIST: '192.168.1.0/24, 10.0.0.1',
        OTT_TRUSTED_PROXIES: '10.0.0.0/8',
        OTT_TOTP_ENCRYPTION_KEY: validKey,
        OTT_WRITE_RATE_LIMIT_IP: '500',
        OTT_WRITE_RATE_LIMIT_ACCOUNT: '250',
      });
      expect(config.mode).toBe('hosted');
      expect(config.totpRequired).toBe(true);
      expect(config.adminAllowlist.length).toBe(2);
      expect(config.trustedProxies.length).toBe(1);
      expect(config.totpEncryptionKey?.length).toBe(32);
      expect(config.writeRateLimit).toEqual({ perIpPerMinute: 500, perAccountPerMinute: 250 });
    });

    it('handles OTT_TRUSTED_PROXIES="none" as explicitly configured empty list', () => {
      const config = loadSecurityConfig({
        OTT_DEPLOYMENT_MODE: 'dev',
        OTT_TRUSTED_PROXIES: 'none',
      });
      expect(config.trustedProxies).toEqual([]);
      expect(config.trustedProxiesConfigured).toBe(true);
    });

    it('rejects invalid encryption key length', () => {
      const shortKey = Buffer.alloc(16).toString('base64');
      expect(() =>
        loadSecurityConfig({
          OTT_DEPLOYMENT_MODE: 'dev',
          OTT_TOTP_ENCRYPTION_KEY: shortKey,
        }),
      ).toThrow(/32 bytes/);
    });
  });

  describe('assertSecurityConfig startup guard (AC-23)', () => {
    it('passes devSecurityConfig without errors', () => {
      expect(() => assertSecurityConfig(devSecurityConfig())).not.toThrow();
    });

    it('passes fully configured hosted configuration', () => {
      const config: SecurityConfig = {
        mode: 'hosted',
        totpRequired: true,
        adminAllowlist: [parseCidr('192.168.1.0/24')],
        trustedProxies: [parseCidr('10.0.0.0/8')],
        totpEncryptionKey: Buffer.alloc(32, 1),
        writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
        trustedProxiesConfigured: true,
      };
      expect(() => assertSecurityConfig(config)).not.toThrow();
    });

    it('fails hosted mode with a single error listing every violation', () => {
      const badHostedConfig: SecurityConfig = {
        mode: 'hosted',
        totpRequired: false, // Violation 1
        adminAllowlist: [], // Violation 2
        trustedProxies: [],
        trustedProxiesConfigured: false, // Violation 3
        totpEncryptionKey: null, // Violation 4
        writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      };

      let thrownError: Error | null = null;
      try {
        assertSecurityConfig(badHostedConfig);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      const msg = thrownError!.message;
      expect(msg).toContain('TOTP must be required');
      expect(msg).toContain('Admin network allowlist must not be empty');
      expect(msg).toContain('Trusted proxies configuration is unset');
      expect(msg).toContain('TOTP encryption key is missing or invalid');
    });

    it('rejects ambiguous trusted proxy (0.0.0.0/0 or ::/0) in hosted mode', () => {
      const ambiguousConfig: SecurityConfig = {
        mode: 'hosted',
        totpRequired: true,
        adminAllowlist: [parseCidr('192.168.1.0/24')],
        trustedProxies: [parseCidr('0.0.0.0/0')],
        totpEncryptionKey: Buffer.alloc(32, 1),
        writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
        trustedProxiesConfigured: true,
      };

      expect(() => assertSecurityConfig(ambiguousConfig)).toThrow(/ambiguous/);
    });

    it('rejects TOTP enabled in dev without encryption key', () => {
      const devTotpNoKey: SecurityConfig = {
        mode: 'dev',
        totpRequired: true,
        adminAllowlist: [],
        trustedProxies: [],
        totpEncryptionKey: null,
        writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
        trustedProxiesConfigured: true,
      };

      expect(() => assertSecurityConfig(devTotpNoKey)).toThrow(/TOTP encryption key is required/);
    });
  });
});
