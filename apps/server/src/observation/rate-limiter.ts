export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  public constructor(private readonly limit: number, private readonly windowMs: number) {}
  public accept(key: string, nowMs: number): boolean {
    const entries = (this.hits.get(key) ?? []).filter(value => value > nowMs - this.windowMs);
    if (entries.length >= this.limit) { this.hits.set(key, entries); return false; }
    entries.push(nowMs); this.hits.set(key, entries); return true;
  }
}
