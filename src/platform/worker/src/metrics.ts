/**
 * P3-N01: Prometheus metrics registry for match execution and resource enforcement.
 *
 * Implements:
 * - cgroup v2 memory.peak tracking (AC-16 & D-30)
 * - Match attempt outcomes (completed, forfeit, failed)
 * - Bot forfeits categorized by reason (e.g. RESOURCE_LIMIT_EXCEEDED, BOT_TIMEOUT)
 * - Sanitization: strict exclusion of credentials, bot code, or raw stderr.
 */

export interface AttemptMetricRecord {
  readonly matchId: string;
  readonly status: 'completed' | 'forfeit' | 'failed';
  readonly reason?: string;
  readonly policyVersion?: string;
}

export interface MemoryPeakMetricRecord {
  readonly matchId: string;
  readonly side: 'X' | 'O';
  readonly memoryPeakBytes: number;
  readonly status?: 'completed' | 'forfeit' | 'failed';
}

export interface CpuUsageMetricRecord {
  readonly matchId: string;
  readonly side: 'X' | 'O';
  readonly cpuUsageSeconds: number;
}

export interface ForfeitMetricRecord {
  readonly matchId: string;
  readonly side: 'X' | 'O';
  readonly reason: string;
}

export class WorkerMetrics {
  private attempts = new Map<string, number>();
  private memoryPeaks = new Map<string, number>();
  private cpuUsage = new Map<string, number>();
  private forfeits = new Map<string, number>();

  recordAttempt(record: AttemptMetricRecord): void {
    const status = sanitizeMetricToken(record.status);
    const reason = sanitizeMetricToken(record.reason ?? 'UNKNOWN');
    const policy = sanitizeMetricToken(record.policyVersion ?? 'UNKNOWN');
    const key = `policy_version="${policy}",reason="${reason}",status="${status}"`;
    this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
  }

  recordMemoryPeak(record: MemoryPeakMetricRecord): void {
    const matchId = sanitizeMetricToken(record.matchId);
    const side = record.side === 'O' ? 'O' : 'X';
    const status = sanitizeMetricToken(record.status ?? 'completed');
    const key = `match_id="${matchId}",side="${side}",status="${status}"`;
    this.memoryPeaks.set(key, record.memoryPeakBytes);
  }

  recordCpuUsage(record: CpuUsageMetricRecord): void {
    const side = record.side === 'O' ? 'O' : 'X';
    const key = `side="${side}"`;
    this.cpuUsage.set(key, (this.cpuUsage.get(key) ?? 0) + record.cpuUsageSeconds);
  }

  recordForfeit(record: ForfeitMetricRecord): void {
    const reason = sanitizeMetricToken(record.reason);
    const side = record.side === 'O' ? 'O' : 'X';
    const key = `reason="${reason}",side="${side}"`;
    this.forfeits.set(key, (this.forfeits.get(key) ?? 0) + 1);
  }

  getAttempts(): ReadonlyMap<string, number> {
    return this.attempts;
  }

  getMemoryPeaks(): ReadonlyMap<string, number> {
    return this.memoryPeaks;
  }

  getForfeits(): ReadonlyMap<string, number> {
    return this.forfeits;
  }

  reset(): void {
    this.attempts.clear();
    this.memoryPeaks.clear();
    this.cpuUsage.clear();
    this.forfeits.clear();
  }

  scrape(): string {
    const lines: string[] = [];

    lines.push('# HELP ott_match_attempts_total Total number of match attempts executed by worker.');
    lines.push('# TYPE ott_match_attempts_total counter');
    for (const [labels, count] of Array.from(this.attempts.entries()).sort()) {
      lines.push(`ott_match_attempts_total{${labels}} ${count}`);
    }
    if (this.attempts.size === 0) {
      lines.push('ott_match_attempts_total 0');
    }

    lines.push('');
    lines.push('# HELP ott_bot_memory_peak_bytes Peak memory in bytes observed via cgroup v2 for bot execution.');
    lines.push('# TYPE ott_bot_memory_peak_bytes gauge');
    for (const [labels, bytes] of Array.from(this.memoryPeaks.entries()).sort()) {
      lines.push(`ott_bot_memory_peak_bytes{${labels}} ${bytes}`);
    }

    lines.push('');
    lines.push('# HELP ott_bot_cpu_usage_seconds_total Total CPU usage in seconds observed for bot execution.');
    lines.push('# TYPE ott_bot_cpu_usage_seconds_total counter');
    for (const [labels, sec] of Array.from(this.cpuUsage.entries()).sort()) {
      lines.push(`ott_bot_cpu_usage_seconds_total{${labels}} ${sec.toFixed(4)}`);
    }

    lines.push('');
    lines.push('# HELP ott_bot_forfeits_total Total number of bot forfeits categorized by reason.');
    lines.push('# TYPE ott_bot_forfeits_total counter');
    for (const [labels, count] of Array.from(this.forfeits.entries()).sort()) {
      lines.push(`ott_bot_forfeits_total{${labels}} ${count}`);
    }

    lines.push('');
    return lines.join('\n');
  }
}

export function sanitizeMetricToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
}

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /bearer\s+/i,
  /private[_\s]key/i,
  /-----BEGIN/i,
  /import\s+[a-z]/i,
  /def\s+[a-z_]/i,
  /traceback\s+\(most recent call last\)/i,
];

export function assertMetricsSanitized(metricsText: string): void {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(metricsText)) {
      throw new Error(`METRICS_SANITIZATION_FAILED: sensitive pattern ${pattern} detected in metrics`);
    }
  }
}

export const defaultWorkerMetrics = new WorkerMetrics();

