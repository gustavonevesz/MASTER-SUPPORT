import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import type { AgentHello, CapabilityDescriptor } from "../contracts.js";
import type { Clock } from "../session/clock.js";
import { validateCurrentSchema } from "../persistence/migrations.js";

export type InvitationConsumeResult =
  | { accepted: true }
  | { accepted: false; reason: "not_found" | "invalid_secret" | "expired" | "revoked" | "used" };

export class SupportInvitationRepository {
  private constructor(private readonly pool: Pool) {}
  public static async start(databaseUrl: string): Promise<SupportInvitationRepository> {
    const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 3_000 });
    try { await validateCurrentSchema(pool); return new SupportInvitationRepository(pool); }
    catch (error) { await pool.end().catch(() => undefined); throw error; }
  }
  public async create(id: string, hash: Buffer, issuer: string, createdAt: Date, expiresAt: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO support_invitations(invitation_id,secret_hash,issuer,created_at,expires_at,status)
        VALUES($1,$2,$3,$4,$5,'active')`, [id, hash, issuer, createdAt, expiresAt]);
      await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,invitation_id,status)
        VALUES($1,$2,'support_invitation.created',$3,'active')`, [randomUUID(), createdAt, id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  public async consume(id: string, candidateHash: Buffer, hello: AgentHello, now: Date): Promise<InvitationConsumeResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{ secret_hash: Buffer; status: string; expires_at: Date }>(
        "SELECT secret_hash,status,expires_at FROM support_invitations WHERE invitation_id=$1 FOR UPDATE", [id]);
      const row = selected.rows[0];
      if (!row) { await client.query("ROLLBACK"); return { accepted: false, reason: "not_found" }; }
      let reason: InvitationConsumeResult extends infer _ ? "invalid_secret" | "expired" | "revoked" | "used" | undefined : never;
      if (row.status === "revoked") reason = "revoked";
      else if (row.status === "used") reason = "used";
      else if (row.status === "expired" || row.expires_at.getTime() <= now.getTime()) reason = "expired";
      else if (row.secret_hash.length !== candidateHash.length || !timingSafeEqual(row.secret_hash, candidateHash)) reason = "invalid_secret";
      if (reason) {
        if (reason === "expired" && row.status === "active") {
          await client.query("UPDATE support_invitations SET status='expired' WHERE invitation_id=$1", [id]);
          await this.audit(client, id, now, "support_invitation.expired", "expired");
        }
        await client.query("COMMIT"); return { accepted: false, reason };
      }
      await client.query(`UPDATE support_invitations SET status='used',used_at=$2,bound_agent_instance_id=$3,
        negotiated_capabilities=$4::jsonb WHERE invitation_id=$1`,
      [id, now, hello.payload.agentInstanceId, JSON.stringify(hello.payload.supportedCapabilities)]);
      await this.audit(client, id, now, "support_invitation.consumed", "used");
      await client.query("COMMIT"); return { accepted: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  public async revoke(id: string, now: Date): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE support_invitations SET status='revoked',revoked_at=$2
        WHERE invitation_id=$1 AND status='active' AND expires_at>$2`, [id, now]);
      if ((result.rowCount ?? 0) === 1) await this.audit(client, id, now, "support_invitation.revoked", "revoked");
      await client.query("COMMIT"); return (result.rowCount ?? 0) === 1;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  public async inspect(id: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.pool.query(`SELECT invitation_id,issuer,created_at,expires_at,used_at,revoked_at,status,
      bound_agent_instance_id,negotiated_capabilities,encode(secret_hash,'hex') AS secret_hash FROM support_invitations WHERE invitation_id=$1`, [id]);
    return result.rows[0] as Record<string, unknown> | undefined;
  }
  public async close(): Promise<void> { await this.pool.end(); }
  private async audit(client: { query(text: string, values?: unknown[]): Promise<unknown> }, id: string, at: Date, type: string, status: string): Promise<void> {
    await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,invitation_id,status)
      VALUES($1,$2,$3,$4,$5)`, [randomUUID(), at, type, id, status]);
  }
}

export class SupportInvitationService {
  public constructor(private readonly repository: SupportInvitationRepository, private readonly clock: Clock, private readonly ttlMs: number) {}
  public async create(): Promise<{ invitationId: string; secret: string; expiresAt: Date }> {
    const now = this.clock.now(); const secret = randomBytes(32).toString("base64url");
    const result = { invitationId: randomUUID(), secret, expiresAt: new Date(now.getTime() + this.ttlMs) };
    await this.repository.create(result.invitationId, hashSecret(secret), "local_operator", now, result.expiresAt);
    return result;
  }
  public consume(id: string, secret: string, hello: AgentHello): Promise<InvitationConsumeResult> {
    return this.repository.consume(id, hashSecret(secret), hello, this.clock.now());
  }
  public revoke(id: string): Promise<boolean> { return this.repository.revoke(id, this.clock.now()); }
}

export function hashSecret(secret: string): Buffer { return createHash("sha256").update("master-support/invitation/v1\0").update(secret).digest(); }
