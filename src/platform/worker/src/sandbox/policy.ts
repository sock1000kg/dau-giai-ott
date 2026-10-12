/** Versioned local baseline. Tournament quotas remain gated by P2-T15 benchmark. */
export const SANDBOX_POLICY_V1 = Object.freeze({
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
} as const);

export type SandboxPolicy = typeof SANDBOX_POLICY_V1;

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
