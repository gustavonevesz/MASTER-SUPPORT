import type { Clock } from "../session/clock.js";

export class BootstrapRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  public constructor(private readonly clock: Clock, private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 1_000) {}
  public allow(origin: string, invitationId: string): boolean {
    const now = this.clock.now().getTime(); const floor = now - this.windowMs;
    for (const key of [`global`, `origin:${origin}`, `invitation:${invitationId}`]) {
      const recent = (this.attempts.get(key) ?? []).filter(value => value > floor);
      const effectiveLimit = key === "global" ? this.limit * 20 : this.limit;
      if (recent.length >= effectiveLimit) { this.attempts.set(key, recent); return false; }
      recent.push(now); this.attempts.set(key, recent);
    }
    while (this.attempts.size > this.maxKeys) this.attempts.delete(this.attempts.keys().next().value!);
    return true;
  }
}
