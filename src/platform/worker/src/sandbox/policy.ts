export interface SandboxPolicy {
  readonly version: string;
  readonly platform: string;
  readonly user: string;
  readonly networkMode: string;
  readonly readOnlyRootfs: boolean;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly nanoCpus: number;
  readonly pidsLimit: number;
  readonly tmpfsBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxMessageBytes: number;
  readonly startupTimeoutMs: number;
  readonly turnTimeoutMs: number;
  readonly stopGraceMs: number;
}

export interface PinnedResourceProfile {
  readonly memoryMiB?: number;
  readonly milliCpu?: number;
  readonly pids?: number;
  readonly tmpfsMiB?: number;
  readonly startupTimeoutMs?: number;
  readonly turnTimeoutMs?: number;
}

/** Versioned local baseline. Tournament quotas remain gated by P2-T15 benchmark. */
export const SANDBOX_POLICY_V1: SandboxPolicy = Object.freeze({
  version: 'OTT_SANDBOX_V1',
  platform: 'linux/amd64',
  user: '65532:65532',
  networkMode: 'none',
  readOnlyRootfs: true,
  memoryBytes: 256 * 1024 * 1024,
  memorySwapBytes: 256 * 1024 * 1024,
  nanoCpus: 1_000_000_000,
  pidsLimit: 64,
  tmpfsBytes: 64 * 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxMessageBytes: 64 * 1024,
  startupTimeoutMs: 5000,
  turnTimeoutMs: 3000,
  stopGraceMs: 500,
});

export function createSandboxPolicy(profile: PinnedResourceProfile, version = 'OTT_SANDBOX_V1'): SandboxPolicy {
  const memoryBytes = profile.memoryMiB !== undefined ? profile.memoryMiB * 1024 * 1024 : SANDBOX_POLICY_V1.memoryBytes;
  return Object.freeze({
    ...SANDBOX_POLICY_V1,
    version,
    memoryBytes,
    memorySwapBytes: memoryBytes,
    nanoCpus: profile.milliCpu !== undefined ? profile.milliCpu * 1_000_000 : SANDBOX_POLICY_V1.nanoCpus,
    pidsLimit: profile.pids !== undefined ? profile.pids : SANDBOX_POLICY_V1.pidsLimit,
    tmpfsBytes: profile.tmpfsMiB !== undefined ? profile.tmpfsMiB * 1024 * 1024 : SANDBOX_POLICY_V1.tmpfsBytes,
    startupTimeoutMs: profile.startupTimeoutMs ?? SANDBOX_POLICY_V1.startupTimeoutMs,
    turnTimeoutMs: profile.turnTimeoutMs ?? SANDBOX_POLICY_V1.turnTimeoutMs,
  });
}

export function resolveSandboxPolicy(policyVersion: string, profile?: PinnedResourceProfile): SandboxPolicy {
  if (policyVersion !== 'P2_BASELINE_V1' && policyVersion !== 'OTT_SANDBOX_V1' && !policyVersion.startsWith('OTT_ROUND_')) {
    throw new Error('MATCH_POLICY_VERSION_UNSUPPORTED');
  }
  if (!profile) return SANDBOX_POLICY_V1;
  return createSandboxPolicy(profile, policyVersion);
}

export function dockerSandboxHostConfig(policy: SandboxPolicy = SANDBOX_POLICY_V1): Readonly<Record<string, unknown>> {
  return Object.freeze({
    NetworkMode: policy.networkMode,
    ReadonlyRootfs: policy.readOnlyRootfs,
    Privileged: false,
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges:true'],
    Memory: policy.memoryBytes,
    MemorySwap: policy.memorySwapBytes,
    NanoCpus: policy.nanoCpus,
    PidsLimit: policy.pidsLimit,
    Tmpfs: { '/tmp': `rw,noexec,nosuid,size=${policy.tmpfsBytes}` },
    Binds: [],
    Mounts: [],
    Devices: [],
    RestartPolicy: { Name: 'no' },
    AutoRemove: false,
    LogConfig: { Type: 'none' },
  });
}
