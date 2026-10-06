export class MetricsRegistry {
  private readonly counters = new Map<string, number>(); private readonly durations: number[] = [];
  public increment(name: string): void { this.counters.set(name, (this.counters.get(name) ?? 0) + 1); }
  public observeDuration(value: number): void { this.durations.push(value); if (this.durations.length > 1000) this.durations.shift(); }
  public snapshot(sessionsActive: number, observationsActive: number): Record<string, number> {
    const result: Record<string, number> = { sessions_active: sessionsActive, observations_active: observationsActive };
    for (const name of ["observations_started", "observations_completed", "observations_failed", "observations_timed_out",
      "observations_cancelled", "observations_abandoned", "observations_late", "observations_rejected", "messages_rejected",
      "rate_limit_rejections", "backpressure_rejections"]) result[name] = this.counters.get(name) ?? 0;
    result.observation_duration_ms_count = this.durations.length;
    result.observation_duration_ms_sum = this.durations.reduce((sum, value) => sum + value, 0);
    return result;
  }
}
