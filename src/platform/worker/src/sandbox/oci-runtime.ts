import { readFile } from 'node:fs/promises';
import { request, type IncomingMessage, type ClientRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import { SANDBOX_POLICY_V1, dockerSandboxHostConfig, type SandboxPolicy } from './policy.ts';

const API = '/v1.41';
const SOCKET = '/var/run/docker.sock';

export interface DockerRuntimeOptions {
  readonly socketPath?: string;
  readonly policy?: SandboxPolicy;
  readonly cgroupRoot?: string | undefined;
}
export interface RunningContainer { readonly id: string; readonly stream: Duplex }
export interface ContainerSandboxSnapshot {
  readonly user: string;
  readonly networkMode: string;
  readonly readOnlyRootfs: boolean;
  readonly privileged: boolean;
  readonly capDrop: readonly string[];
  readonly securityOptions: readonly string[];
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly nanoCpus: number;
  readonly pidsLimit: number;
  readonly mounts: readonly unknown[];
  readonly binds: readonly string[];
  readonly devices: readonly unknown[];
  readonly tmpfs: Readonly<Record<string, string>>;
}
export interface DockerHostBenchmarkInfo {
  readonly engineVersion: string;
  readonly apiVersion: string;
  readonly os: string;
  readonly architecture: string;
  readonly kernelVersion: string;
  readonly logicalCpus: number;
  readonly memoryBytes: number;
  readonly cgroupVersion: string;
}
export interface DockerContainerStats {
  readonly readAt: string;
  readonly memoryUsageBytes: number;
  readonly memoryLimitBytes: number;
  readonly memoryMaxUsageBytes: number | null;
  readonly cpuUsageNs: number;
  readonly cpuSystemUsageNs: number;
  readonly onlineCpus: number;
  readonly pidsCurrent: number | null;
  readonly cpuPercent: number | null;
}

type DockerImage = { readonly Id: string; readonly Config?: { readonly Entrypoint?: readonly string[] | null } };

export class DockerOciRuntime {
  private readonly socketPath: string;
  private readonly policy: SandboxPolicy;
  private readonly cgroupRoot?: string | undefined;
  constructor(options: DockerRuntimeOptions = {}) {
    this.socketPath = options.socketPath ?? SOCKET;
    this.policy = options.policy ?? SANDBOX_POLICY_V1;
    this.cgroupRoot = options.cgroupRoot;
  }

  async loadAndVerify(archive: Uint8Array, manifestDigest: string, configDigest: string, entrypoint: readonly string[]): Promise<string> {
    await this.requestBuffer('POST', `${API}/images/load?quiet=1&platform=${encodeURIComponent(this.policy.platform)}`, archive, 'application/x-tar');
    const image = await this.requestJson<DockerImage>('GET', `${API}/images/${encodeURIComponent(manifestDigest)}/json`);
    if (image.Id !== manifestDigest || !Array.isArray(image.Config?.Entrypoint)
      || JSON.stringify(image.Config.Entrypoint) !== JSON.stringify(entrypoint)) throw new Error('ARTIFACT_DOCKER_IDENTITY_MISMATCH');
    // Image ID is the manifest digest; config digest is independently pinned in the validated OCI layout.
    if (!/^sha256:[a-f0-9]{64}$/.test(configDigest)) throw new Error('ARTIFACT_CONFIG_DIGEST_MISMATCH');
    return image.Id;
  }

  async createAndStart(imageId: string, entrypoint: readonly string[], name: string): Promise<RunningContainer> {
    const create = await this.requestJson<{ readonly Id: string }>('POST', `${API}/containers/create?name=${encodeURIComponent(name)}`, Buffer.from(JSON.stringify({
      Image: imageId,
      Entrypoint: [...entrypoint],
      Cmd: [],
      User: this.policy.user,
      OpenStdin: true,
      StdinOnce: false,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: dockerSandboxHostConfig(this.policy),
    })));
    let stream: Duplex | undefined;
    try {
      stream = await this.attach(create.Id);
      await this.requestJson('POST', `${API}/containers/${create.Id}/start`);
      return { id: create.Id, stream };
    } catch (error) {
      stream?.destroy();
      await this.remove(create.Id).catch(() => undefined);
      throw error;
    }
  }

  async kill(id: string): Promise<void> {
    await this.requestJson('POST', `${API}/containers/${id}/kill?signal=KILL`).catch((error: unknown) => {
      if (!(error instanceof DockerApiError) || error.status !== 409) throw error;
    });
  }

  async inspectSandbox(id: string): Promise<ContainerSandboxSnapshot> {
    const value = await this.requestJson<{
      readonly Config?: { readonly User?: string };
      readonly HostConfig?: {
        readonly NetworkMode?: string; readonly ReadonlyRootfs?: boolean; readonly Privileged?: boolean;
        readonly CapDrop?: readonly string[]; readonly SecurityOpt?: readonly string[]; readonly Memory?: number;
        readonly MemorySwap?: number; readonly NanoCpus?: number;
        readonly PidsLimit?: number; readonly Mounts?: readonly unknown[]; readonly Binds?: readonly string[];
        readonly Devices?: readonly unknown[]; readonly Tmpfs?: Readonly<Record<string, string>>;
      };
    }>('GET', `${API}/containers/${id}/json`);
    const config = value.HostConfig;
    return {
      user: value.Config?.User ?? '', networkMode: config?.NetworkMode ?? '', readOnlyRootfs: config?.ReadonlyRootfs === true,
      privileged: config?.Privileged === true, capDrop: config?.CapDrop ?? [], securityOptions: config?.SecurityOpt ?? [],
      memoryBytes: config?.Memory ?? 0, memorySwapBytes: config?.MemorySwap ?? 0,
      nanoCpus: config?.NanoCpus ?? 0, pidsLimit: config?.PidsLimit ?? 0, mounts: config?.Mounts ?? [],
      binds: config?.Binds ?? [], devices: config?.Devices ?? [], tmpfs: config?.Tmpfs ?? {},
    };
  }

  async benchmarkHostInfo(): Promise<DockerHostBenchmarkInfo> {
    const [version, info] = await Promise.all([
      this.requestJson<{ readonly Version?: string; readonly ApiVersion?: string; readonly Os?: string; readonly Arch?: string; readonly KernelVersion?: string }>('GET', `${API}/version`),
      this.requestJson<{ readonly OperatingSystem?: string; readonly Architecture?: string; readonly KernelVersion?: string; readonly NCPU?: number; readonly MemTotal?: number; readonly CgroupVersion?: string }>('GET', `${API}/info`),
    ]);
    return {
      engineVersion: version.Version ?? '', apiVersion: version.ApiVersion ?? '',
      os: info.OperatingSystem ?? version.Os ?? '', architecture: info.Architecture ?? version.Arch ?? '',
      kernelVersion: info.KernelVersion ?? version.KernelVersion ?? '', logicalCpus: info.NCPU ?? 0,
      memoryBytes: info.MemTotal ?? 0, cgroupVersion: info.CgroupVersion ?? 'unknown',
    };
  }

  /** One Docker stats response; stream=false returns one bounded sample and closes the HTTP request. */
  /** Docker Engine stats formula: cpuDelta / systemCpuDelta * online CPUs * 100; API docs: https://docs.docker.com/reference/api/engine/version/v1.56/#get-container-stats-based-on-resource-usage */
  async benchmarkStats(id: string): Promise<DockerContainerStats> {
    const stats = await this.requestJson<{
      readonly read?: string;
      readonly memory_stats?: { readonly usage?: number; readonly limit?: number; readonly max_usage?: number };
      readonly cpu_stats?: { readonly cpu_usage?: { readonly total_usage?: number; readonly percpu_usage?: readonly number[] }; readonly system_cpu_usage?: number; readonly online_cpus?: number };
      readonly precpu_stats?: { readonly cpu_usage?: { readonly total_usage?: number; readonly percpu_usage?: readonly number[] }; readonly system_cpu_usage?: number; readonly online_cpus?: number };
      readonly pids_stats?: { readonly current?: number };
    }>('GET', `${API}/containers/${id}/stats?stream=false`);
    const cpu = stats.cpu_stats;
    const previousCpu = stats.precpu_stats;
    const cpuUsageNs = cpu?.cpu_usage?.total_usage ?? 0;
    const previousCpuUsageNs = previousCpu?.cpu_usage?.total_usage ?? 0;
    const systemCpuUsageNs = cpu?.system_cpu_usage ?? 0;
    const previousSystemCpuUsageNs = previousCpu?.system_cpu_usage ?? 0;
    const onlineCpus = cpu?.online_cpus ?? cpu?.cpu_usage?.percpu_usage?.length ?? 0;
    const cpuDelta = cpuUsageNs - previousCpuUsageNs;
    const systemDelta = systemCpuUsageNs - previousSystemCpuUsageNs;
    const memory = stats.memory_stats;
    return {
      readAt: stats.read ?? new Date().toISOString(), memoryUsageBytes: memory?.usage ?? 0,
      memoryLimitBytes: memory?.limit ?? 0, memoryMaxUsageBytes: memory?.max_usage ?? null,
      cpuUsageNs, cpuSystemUsageNs: systemCpuUsageNs, onlineCpus, pidsCurrent: stats.pids_stats?.current ?? null,
      cpuPercent: cpuDelta >= 0 && systemDelta > 0 && onlineCpus > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : null,
    };
  }

  /** Reads cgroup v2 memory.peak for container or falls back to Docker stats. */
  async readMemoryPeak(id: string): Promise<number | null> {
    const candidatePaths: string[] = [];
    if (this.cgroupRoot) {
      candidatePaths.push(
        `${this.cgroupRoot}/system.slice/docker-${id}.scope/memory.peak`,
        `${this.cgroupRoot}/docker/${id}/memory.peak`,
        `${this.cgroupRoot}/${id}/memory.peak`,
        `${this.cgroupRoot}/memory.peak`,
      );
    }
    candidatePaths.push(
      `/sys/fs/cgroup/system.slice/docker-${id}.scope/memory.peak`,
      `/sys/fs/cgroup/docker/${id}/memory.peak`,
      `/sys/fs/cgroup/${id}/memory.peak`,
    );

    for (const p of candidatePaths) {
      try {
        const text = await readFile(p, 'utf8');
        const parsed = parseInt(text.trim(), 10);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
      } catch {
        // try next
      }
    }

    try {
      const stats = await this.benchmarkStats(id);
      return stats.memoryMaxUsageBytes ?? (stats.memoryUsageBytes > 0 ? stats.memoryUsageBytes : null);
    } catch {
      return null;
    }
  }

  async wait(id: string): Promise<{ readonly statusCode: number; readonly oomKilled: boolean }> {
    const value = await this.requestJson<{ readonly StatusCode: number }>('POST', `${API}/containers/${id}/wait?condition=not-running`);
    const inspect = await this.requestJson<{ readonly State?: { readonly OOMKilled?: boolean; readonly ExitCode?: number } }>('GET', `${API}/containers/${id}/json`);
    const oomKilled = inspect.State?.OOMKilled === true || value.StatusCode === 137 || inspect.State?.ExitCode === 137;
    return { statusCode: value.StatusCode, oomKilled };
  }

  async remove(id: string): Promise<void> {
    await this.requestJson('DELETE', `${API}/containers/${id}?force=true&v=false`).catch((error: unknown) => {
      if (!(error instanceof DockerApiError) || error.status !== 404) throw error;
    });
  }

  private async attach(id: string): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: this.socketPath, path: `${API}/containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1`, method: 'POST', headers: { Connection: 'Upgrade', Upgrade: 'tcp' } });
      req.once('upgrade', (_response, socket) => resolve(socket));
      req.once('response', (response) => rejectResponse(response, reject));
      req.once('error', reject);
      req.end();
    });
  }

  private requestBuffer(method: string, path: string, body: Uint8Array, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: this.socketPath, path, method, headers: { 'Content-Type': contentType, 'Content-Length': body.byteLength } }, (res) => {
        collectResponse(res).then(() => checkStatus(res, resolve, reject), reject);
      });
      req.once('error', reject);
      req.end(body);
    });
  }

  private requestJson<T = unknown>(method: string, path: string, body?: Uint8Array): Promise<T> {
    return new Promise((resolve, reject) => {
      const req: ClientRequest = request({ socketPath: this.socketPath, path, method, ...(body ? { headers: { 'Content-Type': 'application/json', 'Content-Length': body.byteLength } } : {}) }, (res) => {
        collectResponse(res).then((data) => {
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) return reject(new DockerApiError(res.statusCode ?? 500, data.toString('utf8')));
          if (data.byteLength === 0) return resolve(undefined as T);
          try { resolve(JSON.parse(data.toString('utf8')) as T); } catch { reject(new Error('DOCKER_RESPONSE_INVALID')); }
        }, reject);
      });
      req.once('error', reject);
      if (body) req.end(body); else req.end();
    });
  }
}

export class DockerApiError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function collectResponse(res: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.once('error', reject);
    res.once('end', () => resolve(Buffer.concat(chunks)));
  });
}
function checkStatus(res: IncomingMessage, resolve: () => void, reject: (error: Error) => void): void {
  if ((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300) resolve();
  else reject(new DockerApiError(res.statusCode ?? 500, 'DOCKER_REQUEST_FAILED'));
}
function rejectResponse(response: IncomingMessage, reject: (error: Error) => void): void {
  collectResponse(response).then((body) => reject(new DockerApiError(response.statusCode ?? 500, body.toString('utf8'))), reject);
}
