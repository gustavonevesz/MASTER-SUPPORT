import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { CapabilityDescriptor } from "../contracts.js";
import type { Clock } from "../session/clock.js";

export type TicketKind = "connection" | "resume";
export type TicketClaims = Readonly<{ kind: TicketKind; agentInstanceId: string; sessionId?: string; capabilities: readonly CapabilityDescriptor[] }>;
type StoredTicket = TicketClaims & { hash: Buffer; expiresAt: Date };

export class EphemeralTicketStore {
  private readonly tickets = new Map<string, StoredTicket>();
  public constructor(private readonly clock: Clock, private readonly connectionTtlMs: number, private readonly resumeTtlMs: number) {}
  public issue(claims: TicketClaims): { ticket: string; expiresAt: Date } {
    const id = randomUUID(); const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.clock.now().getTime() + (claims.kind === "connection" ? this.connectionTtlMs : this.resumeTtlMs));
    this.tickets.set(id, { ...claims, hash: hash(secret), expiresAt });
    return { ticket: `${id}.${secret}`, expiresAt };
  }
  public consume(ticket: string, kind: TicketKind): TicketClaims | undefined {
    const claims = this.consumeAny(ticket); return claims?.kind === kind ? claims : undefined;
  }
  public consumeAny(ticket: string): TicketClaims | undefined {
    const [id, secret, extra] = ticket.split(".");
    if (!id || !secret || extra) return undefined;
    const stored = this.tickets.get(id); if (!stored) return undefined;
    this.tickets.delete(id);
    const candidate = hash(secret);
    if (stored.expiresAt.getTime() <= this.clock.now().getTime() ||
      stored.hash.length !== candidate.length || !timingSafeEqual(stored.hash, candidate)) return undefined;
    return { kind: stored.kind, agentInstanceId: stored.agentInstanceId,
      ...(stored.sessionId ? { sessionId: stored.sessionId } : {}), capabilities: stored.capabilities };
  }
  public revokeSession(sessionId: string): void {
    for (const [id, ticket] of this.tickets) if (ticket.sessionId === sessionId) this.tickets.delete(id);
  }
  public size(): number { return this.tickets.size; }
}
function hash(value: string): Buffer { return createHash("sha256").update("master-support/ticket/v1\0").update(value).digest(); }
