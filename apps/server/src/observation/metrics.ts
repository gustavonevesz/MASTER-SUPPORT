export class MetricsRegistry {
  private readonly counters = new Map<string, number>(); private readonly durations: number[] = [];
  private readonly gauges = new Map<string, number>();
  private readonly preflightDurations:number[]=[];
  private databaseConnected = false;
  public increment(name: string): void { this.counters.set(name, (this.counters.get(name) ?? 0) + 1); }
  public setGauge(name: string, value: number): void { this.gauges.set(name, value); }
  public setDatabaseConnected(connected: boolean): void { this.databaseConnected = connected; }
  public observePreflightDuration(value:number):void{this.preflightDurations.push(value);if(this.preflightDurations.length>1000)this.preflightDurations.shift();}
  public observeDuration(value: number): void { this.durations.push(value); if (this.durations.length > 1000) this.durations.shift(); }
  public snapshot(sessionsActive: number, observationsActive: number): Record<string, number> {
    const result: Record<string, number> = { sessions_active: sessionsActive, observations_active: observationsActive,
      db_connection_state: this.databaseConnected ? 1 : 0 };
    for (const name of ["observations_started", "observations_completed", "observations_failed", "observations_timed_out",
      "observations_cancelled", "observations_abandoned", "observations_late", "observations_rejected", "messages_rejected",
      "rate_limit_rejections", "backpressure_rejections", "db_operation_failures", "restart_reconciliations",
      "abandoned_after_restart"]) result[name] = this.counters.get(name) ?? 0;
    for(const name of ["preflight_started","preflight_completed","preflight_partial","preflight_failed","preflight_cancelled","preflight_capability_failure"])
      result[name]=this.counters.get(name)??0;
    for(const name of ["assets_created","assets_retired","asset_links_created","asset_links_corrected"])
      result[name]=this.counters.get(name)??0;
    result.unreviewed_endpoints=this.gauges.get("unreviewed_endpoints")??0;
    result.observation_duration_ms_count = this.durations.length;
    result.observation_duration_ms_sum = this.durations.reduce((sum, value) => sum + value, 0);
    result.preflight_duration_ms_count=this.preflightDurations.length;result.preflight_duration_ms_sum=this.preflightDurations.reduce((sum,value)=>sum+value,0);
    return result;
  }
}
