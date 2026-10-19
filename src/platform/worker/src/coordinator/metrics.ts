import { sanitizeMetricToken } from '../metrics.ts';

export type CoordinatorLoopName = 'preflight' | 'dispatch' | 'settle' | 'snapshot' | 'retention';
export type CoordinatorRole = 'active' | 'standby';

export class CoordinatorMetrics {
  private iterations = new Map<string, number>();
  private errors = new Map<string, number>();
  private lastSuccess = new Map<string, number>();
  private processed = new Map<string, number>();
  private currentRole: CoordinatorRole = 'standby';

  public incrementIterations(loop: CoordinatorLoopName): void {
    const key = `loop="${sanitizeMetricToken(loop)}"`;
    this.iterations.set(key, (this.iterations.get(key) ?? 0) + 1);
  }

  public incrementErrors(loop: CoordinatorLoopName, options?: { kind?: string }): void {
    const key = options?.kind
      ? `loop="${sanitizeMetricToken(loop)}",kind="${sanitizeMetricToken(options.kind)}"`
      : `loop="${sanitizeMetricToken(loop)}"`;
    this.errors.set(key, (this.errors.get(key) ?? 0) + 1);
  }

  public recordSuccess(loop: CoordinatorLoopName, timestampSeconds: number = Date.now() / 1000): void {
    const key = `loop="${sanitizeMetricToken(loop)}"`;
    this.lastSuccess.set(key, timestampSeconds);
  }

  public addProcessed(loop: CoordinatorLoopName, count = 1): void {
    if (count <= 0) return;
    const key = `loop="${sanitizeMetricToken(loop)}"`;
    this.processed.set(key, (this.processed.get(key) ?? 0) + count);
  }

  public setRole(role: CoordinatorRole): void {
    this.currentRole = role;
  }

  public getRole(): CoordinatorRole {
    return this.currentRole;
  }

  public getIterations(loop: CoordinatorLoopName): number {
    return this.iterations.get(`loop="${loop}"`) ?? 0;
  }

  public getErrors(loop: CoordinatorLoopName, options?: { kind?: string } | string): number {
    const kind = typeof options === 'string' ? options : options?.kind;
    const key = kind
      ? `loop="${sanitizeMetricToken(loop)}",kind="${sanitizeMetricToken(kind)}"`
      : `loop="${sanitizeMetricToken(loop)}"`;
    return this.errors.get(key) ?? 0;
  }

  public getProcessed(loop: CoordinatorLoopName): number {
    return this.processed.get(`loop="${loop}"`) ?? 0;
  }

  public reset(): void {
    this.iterations.clear();
    this.errors.clear();
    this.lastSuccess.clear();
    this.processed.clear();
    this.currentRole = 'standby';
  }

  public scrape(): string {
    const lines: string[] = [];

    // 1. Iterations
    lines.push('# HELP ott_coordinator_loop_iterations_total Total iterations executed per coordinator loop.');
    lines.push('# TYPE ott_coordinator_loop_iterations_total counter');
    for (const [labels, count] of Array.from(this.iterations.entries()).sort()) {
      lines.push(`ott_coordinator_loop_iterations_total{${labels}} ${count}`);
    }
    if (this.iterations.size === 0) {
      lines.push('ott_coordinator_loop_iterations_total 0');
    }

    lines.push('');

    // 2. Errors
    lines.push('# HELP ott_coordinator_loop_errors_total Total errors encountered per coordinator loop.');
    lines.push('# TYPE ott_coordinator_loop_errors_total counter');
    for (const [labels, count] of Array.from(this.errors.entries()).sort()) {
      lines.push(`ott_coordinator_loop_errors_total{${labels}} ${count}`);
    }
    if (this.errors.size === 0) {
      lines.push('ott_coordinator_loop_errors_total 0');
    }

    lines.push('');

    // 3. Last success timestamp
    lines.push('# HELP ott_coordinator_last_success_timestamp_seconds Unix timestamp of last successful loop iteration.');
    lines.push('# TYPE ott_coordinator_last_success_timestamp_seconds gauge');
    for (const [labels, ts] of Array.from(this.lastSuccess.entries()).sort()) {
      lines.push(`ott_coordinator_last_success_timestamp_seconds{${labels}} ${ts.toFixed(3)}`);
    }

    lines.push('');

    // 4. Processed items
    lines.push('# HELP ott_coordinator_processed_total Total items processed per coordinator loop.');
    lines.push('# TYPE ott_coordinator_processed_total counter');
    for (const [labels, count] of Array.from(this.processed.entries()).sort()) {
      lines.push(`ott_coordinator_processed_total{${labels}} ${count}`);
    }
    if (this.processed.size === 0) {
      lines.push('ott_coordinator_processed_total 0');
    }

    lines.push('');

    // 5. Role
    lines.push('# HELP ott_coordinator_role Current coordinator role (1 for active role, 0 otherwise).');
    lines.push('# TYPE ott_coordinator_role gauge');
    lines.push(`ott_coordinator_role{role="active"} ${this.currentRole === 'active' ? 1 : 0}`);
    lines.push(`ott_coordinator_role{role="standby"} ${this.currentRole === 'standby' ? 1 : 0}`);

    lines.push('');
    return lines.join('\n');
  }
}

export const defaultCoordinatorMetrics = new CoordinatorMetrics();
