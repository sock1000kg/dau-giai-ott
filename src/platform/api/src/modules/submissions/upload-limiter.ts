export interface UploadLimiterOptions {
  readonly maxConcurrent?: number;
  readonly maxConcurrentPerTeam?: number;
  readonly retryAfterBaseSeconds?: number;
}

export interface AcquireResult {
  readonly acquired: boolean;
  readonly retryAfter?: number;
}

export class UploadLimiter {
  private readonly maxConcurrent: number;
  private readonly maxConcurrentPerTeam: number;
  private readonly retryAfterBaseSeconds: number;

  private currentGlobal = 0;
  private readonly teamActive = new Map<string, number>();

  public constructor(options?: UploadLimiterOptions) {
    this.maxConcurrent = options?.maxConcurrent ?? 8;
    this.maxConcurrentPerTeam = options?.maxConcurrentPerTeam ?? 1;
    this.retryAfterBaseSeconds = Math.max(1, options?.retryAfterBaseSeconds ?? 5);
  }

  public tryAcquire(teamId: string): AcquireResult {
    const currentTeam = this.teamActive.get(teamId) ?? 0;
    if (currentTeam >= this.maxConcurrentPerTeam) {
      return {
        acquired: false,
        retryAfter: this.retryAfterBaseSeconds,
      };
    }

    if (this.currentGlobal >= this.maxConcurrent) {
      const position = this.currentGlobal - this.maxConcurrent + 1;
      return {
        acquired: false,
        retryAfter: this.retryAfterBaseSeconds + position,
      };
    }

    this.currentGlobal += 1;
    this.teamActive.set(teamId, currentTeam + 1);
    return { acquired: true };
  }

  public release(teamId: string): void {
    const currentTeam = this.teamActive.get(teamId) ?? 0;
    if (currentTeam <= 1) {
      this.teamActive.delete(teamId);
    } else {
      this.teamActive.set(teamId, currentTeam - 1);
    }
    if (this.currentGlobal > 0) {
      this.currentGlobal -= 1;
    }
  }

  public getStats(): { readonly globalActive: number; readonly activeTeams: number } {
    return {
      globalActive: this.currentGlobal,
      activeTeams: this.teamActive.size,
    };
  }

  public reset(): void {
    this.currentGlobal = 0;
    this.teamActive.clear();
  }
}
