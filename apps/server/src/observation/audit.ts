export type OperationalAuditEvent = Readonly<{ eventId: string; occurredAt: string; eventType: string; sessionId: string;
  requestId: string; capabilityId: string; status: string; reason?: string }>;
export class InMemoryAuditStore {
  private readonly events: OperationalAuditEvent[] = [];
  public constructor(private readonly capacity = 1000) {}
  public append(event: OperationalAuditEvent): void { this.events.push(event); while (this.events.length > this.capacity) this.events.shift(); }
  public list(): readonly OperationalAuditEvent[] { return [...this.events]; }
}
