import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { OperationalAuditEvent } from "../observation/audit.js";
import type { ObservationRequestRecord } from "../observation/store.js";
import type { Session } from "../session/session.js";
import { validateCurrentSchema } from "./migrations.js";
import type { DurablePersistence } from "./models.js";
import { minimizeCapabilityFacts } from "../preflight/minimization.js";
import type { PreflightRun } from "../preflight/models.js";

const activeStates = ["created", "accepted", "executing"];

export class PostgresPersistence implements DurablePersistence {
  public readonly serverInstanceId = randomUUID();
  public connected = false;
  private constructor(private readonly pool: Pool) {}

  public static async start(databaseUrl: string, now = new Date()): Promise<PostgresPersistence> {
    if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required");
    const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 3_000 });
    const persistence = new PostgresPersistence(pool);
    try {
      await validateCurrentSchema(pool);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO server_instances(server_instance_id, started_at) VALUES ($1, $2)", [persistence.serverInstanceId, now]);
        await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,status)
          VALUES($1,$2,'server.started',$3,'started')`, [randomUUID(), now, persistence.serverInstanceId]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      persistence.connected = true;
      return persistence;
    } catch (error) { await pool.end().catch(() => undefined); throw error; }
  }

  public async persistSessionCreated(session: Session): Promise<void> {
    await this.transaction(async client => {
      await client.query(`INSERT INTO session_records(session_id, agent_instance_id, protocol_version, server_instance_id,
        created_at, last_seen_at, historical_status, capabilities, authenticated) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [session.id, session.agentInstanceId, session.protocolVersion, this.serverInstanceId, session.createdAt,
        session.lastSeenAt, session.state, JSON.stringify(session.capabilities), session.authenticated ?? false]);
      await this.insertAudit(client, { eventId: randomUUID(), occurredAt: session.createdAt.toISOString(), eventType: "session.created",
        sessionId: session.id, requestId: "", capabilityId: "", status: session.state });
    });
  }

  public async persistSessionState(session: Session, endReason?: string): Promise<void> {
    const terminal = ["closed", "expired", "revoked"].includes(session.state) || endReason === "server_restart" || endReason === "server_shutdown";
    await this.transaction(async client => {
      await client.query(`UPDATE session_records SET last_seen_at=$2, historical_status=$3,
        ended_at=CASE WHEN $4::boolean THEN COALESCE(ended_at,$2) ELSE ended_at END,
        end_reason=CASE WHEN $4::boolean THEN COALESCE(end_reason,$5) ELSE end_reason END WHERE session_id=$1`,
      [session.id, session.lastSeenAt, session.state, terminal, endReason ?? session.state]);
      await this.insertAudit(client, { eventId: randomUUID(), occurredAt: new Date().toISOString(), eventType: `session.${endReason ?? session.state}`,
        sessionId: session.id, requestId: "", capabilityId: "", status: session.state, ...(endReason ? { reason: endReason } : {}) });
    });
  }

  public async persistObservationBeforeDispatch(record: ObservationRequestRecord): Promise<void> {
    await this.transaction(async client => {
      await client.query(`INSERT INTO observation_requests(request_id,session_id,server_instance_id,capability_id,
        capability_version,created_at,deadline,state,outcome_unknown) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [record.requestId, record.sessionId, this.serverInstanceId, record.capabilityId, record.capabilityVersion,
        record.createdAt, record.deadline, record.state, record.outcomeUnknown ?? false]);
      await this.insertAudit(client, { eventId: randomUUID(), occurredAt: record.createdAt, eventType: "observation.requested",
        sessionId: record.sessionId, requestId: record.requestId, capabilityId: record.capabilityId, status: record.state });
    });
  }

  public async persistObservation(record: ObservationRequestRecord, event?: OperationalAuditEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(`UPDATE observation_requests SET state=$2,completed_at=$3,duration_ms=$4,outcome_unknown=$5,
        outcome_message_id=$6,failure_code=$7,failure_message=$8 WHERE request_id=$1
        AND (state NOT IN ('completed','failed','timed_out','cancelled','abandoned') OR state=$2)`,
      [record.requestId, record.state, record.completedAt ?? null, record.durationMs ?? null, record.outcomeUnknown ?? false,
        record.outcomeMessageId ?? null, record.failure?.code ?? null, record.failure?.message ?? null]);
      if ((updated.rowCount ?? 0) > 0 && record.state === "completed" && record.evidence && record.observation)
        await this.persistAcceptedResult(client, record);
      if (event) await this.insertAudit(client, event);
      await client.query("COMMIT"); this.connected = true;
    } catch (error) { await client.query("ROLLBACK"); this.connected = false; throw error; }
    finally { client.release(); }
  }

  public async appendAudit(event: OperationalAuditEvent): Promise<void> { await this.audit(event); }

  public async reconcileRestart(): Promise<{ sessions: number; observations: number }> {
    const client = await this.pool.connect(); const now = new Date();
    try {
      await client.query("BEGIN");
      const sessions = await client.query<{ session_id: string }>(`UPDATE session_records SET ended_at=$1,
        end_reason='server_restart',historical_status='interrupted' WHERE ended_at IS NULL AND server_instance_id<>$2 RETURNING session_id`,
      [now, this.serverInstanceId]);
      const observations = await client.query<{ request_id: string; session_id: string; capability_id: string }>(`UPDATE observation_requests
        SET state='abandoned',completed_at=$1,outcome_unknown=true,failure_code='server_restart',
        failure_message='Control Plane restarted before durable outcome reconciliation.'
        WHERE state=ANY($2::text[]) AND server_instance_id<>$3 RETURNING request_id,session_id,capability_id`,
      [now, activeStates, this.serverInstanceId]);
      for (const row of sessions.rows) await this.insertAudit(client, { eventId: randomUUID(), occurredAt: now.toISOString(),
        eventType: "session.interrupted_by_restart", sessionId: row.session_id, requestId: "", capabilityId: "", status: "interrupted", reason: "server_restart" });
      for (const row of observations.rows) await this.insertAudit(client, { eventId: randomUUID(), occurredAt: now.toISOString(),
        eventType: "observation.reconciled_after_restart", sessionId: row.session_id, requestId: row.request_id,
        capabilityId: row.capability_id, status: "abandoned", reason: "server_restart" });
      const preflights = await client.query<{preflight_run_id:string;session_id:string}>(`UPDATE preflight_runs SET status='interrupted',completed_at=$1,
        duration_ms=GREATEST(0,EXTRACT(EPOCH FROM ($1-created_at))*1000)::integer WHERE status IN ('created','running') AND server_instance_id<>$2
        RETURNING preflight_run_id,session_id`,[now,this.serverInstanceId]);
      for(const row of preflights.rows) await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,session_id,
        preflight_run_id,status,reason) VALUES($1,$2,'preflight.interrupted',$3,$4,$5,'interrupted','server_restart')`,
      [randomUUID(),now,this.serverInstanceId,row.session_id,row.preflight_run_id]);
      await client.query("COMMIT"); this.connected = true;
      return { sessions: sessions.rowCount ?? 0, observations: observations.rowCount ?? 0 };
    } catch (error) { await client.query("ROLLBACK"); this.connected = false; throw error; }
    finally { client.release(); }
  }

  public async sessionHistory(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.query<Record<string, unknown>>(`SELECT session_id,agent_instance_id,protocol_version,
      server_instance_id,created_at,last_seen_at,ended_at,end_reason,historical_status,capabilities,authenticated FROM session_records WHERE session_id=$1`, [sessionId]);
    return result.rows[0];
  }

  public async observationHistory(requestId: string): Promise<Record<string, unknown> | undefined> {
    const result = await this.query<Record<string, unknown>>(`SELECT r.request_id,r.session_id,r.server_instance_id,r.capability_id,
      r.capability_version,r.created_at,r.deadline,r.state,r.completed_at,r.duration_ms,r.outcome_unknown,r.failure_code,
      e.evidence_id,e.collected_at,e.source,e.data_handling_state AS evidence_data_handling_state,e.payload_size,
      o.observation_id,o.observed_at,o.kind,o.statement,o.data_handling_state,o.facts
      FROM observation_requests r LEFT JOIN evidence_metadata e ON e.observation_request_id=r.request_id
      LEFT JOIN observations o ON o.observation_request_id=r.request_id WHERE r.request_id=$1`, [requestId]);
    return result.rows[0];
  }

  public async persistPreflightStarted(run: PreflightRun): Promise<void> {
    await this.transaction(async client=>{ await client.query(`INSERT INTO preflight_runs(preflight_run_id,session_id,server_instance_id,created_at,started_at,status)
      VALUES($1,$2,$3,$4,$5,'running')`,[run.preflightRunId,run.sessionId,this.serverInstanceId,run.createdAt,run.startedAt]);
      await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,session_id,preflight_run_id,status)
        VALUES($1,$2,'preflight.started',$3,$4,$5,'running')`,[randomUUID(),run.startedAt,this.serverInstanceId,run.sessionId,run.preflightRunId]); });
  }

  public async persistPreflightFinished(run: PreflightRun): Promise<void> {
    await this.transaction(async client=>{
      let endpointId:string|null=null;
      if(run.observedEndpoint){ const endpoint=run.observedEndpoint; const saved=await client.query<{observed_endpoint_id:string}>(`INSERT INTO observed_endpoints(
        observed_endpoint_id,session_id,observed_machine_name,platform,first_observed_at,last_observed_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(session_id) DO UPDATE SET observed_machine_name=EXCLUDED.observed_machine_name,platform=EXCLUDED.platform,last_observed_at=EXCLUDED.last_observed_at
        RETURNING observed_endpoint_id`,[endpoint.observedEndpointId,endpoint.sessionId,endpoint.observedMachineName??null,endpoint.platform,endpoint.firstObservedAt,endpoint.lastObservedAt]); endpointId=saved.rows[0]!.observed_endpoint_id; }
      await client.query(`UPDATE preflight_runs SET observed_endpoint_id=$2,completed_at=$3,status=$4,duration_ms=$5,capability_failure_count=$6 WHERE preflight_run_id=$1`,
        [run.preflightRunId,endpointId,run.completedAt,run.status,run.durationMs,run.capabilityFailureCount]);
      for(const result of run.capabilityResults) await client.query(`INSERT INTO preflight_observations(preflight_run_id,capability_id,observation_request_id)
        VALUES($1,$2,$3)`,[run.preflightRunId,result.capabilityId,result.requestId]);
      if(run.snapshot) await client.query(`INSERT INTO preflight_snapshots(preflight_run_id,captured_at,agent_version,protocol_version,completeness_percent,
        data_classification,capability_versions,observation_ids) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,[run.preflightRunId,run.snapshot.capturedAt,
        run.snapshot.agentVersion??null,run.snapshot.protocolVersion,run.snapshot.completenessPercent,run.snapshot.dataClassification,
        JSON.stringify(run.snapshot.capabilityVersions),JSON.stringify(run.snapshot.observationIds)]);
      await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,session_id,preflight_run_id,observed_endpoint_id,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),run.completedAt,`preflight.${run.status}`,this.serverInstanceId,run.sessionId,run.preflightRunId,endpointId,run.status]);
      if(endpointId) await client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,session_id,preflight_run_id,observed_endpoint_id,status)
        VALUES($1,$2,'endpoint.observed',$3,$4,$5,$6,'observed')`,[randomUUID(),run.completedAt,this.serverInstanceId,run.sessionId,run.preflightRunId,endpointId]);
    });
  }

  public async preflightHistory(id:string):Promise<Record<string,unknown>|undefined>{ const result=await this.query<Record<string,unknown>>(`SELECT r.*,
    s.captured_at,s.agent_version,s.protocol_version,s.completeness_percent,s.data_classification,s.capability_versions,s.observation_ids,
    e.observed_machine_name,e.platform,e.first_observed_at,e.last_observed_at FROM preflight_runs r LEFT JOIN preflight_snapshots s USING(preflight_run_id)
    LEFT JOIN observed_endpoints e USING(observed_endpoint_id) WHERE r.preflight_run_id=$1`,[id]);return result.rows[0]; }
  public async listPreflightHistory(sessionId:string):Promise<readonly Record<string,unknown>[]>{const result=await this.query<Record<string,unknown>>(
    `SELECT preflight_run_id,session_id,observed_endpoint_id,created_at,started_at,completed_at,status,duration_ms,capability_failure_count
     FROM preflight_runs WHERE session_id=$1 ORDER BY created_at`,[sessionId]);return result.rows;}

  public async finish(): Promise<void> {
    try {
      const endedAt = new Date();
      await this.query(`WITH ended AS (UPDATE server_instances SET ended_at=$2 WHERE server_instance_id=$1 AND ended_at IS NULL RETURNING 1)
        INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,status)
        SELECT $3,$2,'server.ended',$1,'ended' FROM ended`, [this.serverInstanceId, endedAt, randomUUID()]);
    }
    finally { this.connected = false; await this.pool.end(); }
  }

  private async persistAcceptedResult(client: PoolClient, record: ObservationRequestRecord): Promise<void> {
    const evidence = record.evidence!; const observation = record.observation!;
    const payloadSize = Buffer.byteLength(JSON.stringify(evidence.payload), "utf8");
    await client.query(`INSERT INTO evidence_metadata(evidence_id,observation_request_id,capability_id,capability_version,
      collected_at,source,data_handling_state,payload_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(observation_request_id) DO NOTHING`,
    [evidence.evidenceId, record.requestId, evidence.capabilityId, evidence.capabilityVersion, evidence.collectedAt,
      evidence.source, evidence.dataHandlingState, payloadSize]);
    await client.query(`INSERT INTO observations(observation_id,observation_request_id,evidence_id,observed_at,kind,
      statement,data_handling_state,facts) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(observation_request_id) DO NOTHING`,
    [observation.observationId, record.requestId, observation.evidenceId, observation.observedAt,
      observation.kind, observation.statement, observation.dataHandlingState ?? "MINIMIZED",
      JSON.stringify(minimizeCapabilityFacts(record.capabilityId, evidence.payload))]);
  }

  private async audit(event: OperationalAuditEvent): Promise<void> {
    const client = await this.pool.connect();
    try { await this.insertAudit(client, event); this.connected = true; }
    catch (error) { this.connected = false; throw error; }
    finally { client.release(); }
  }
  private insertAudit(client: PoolClient, event: OperationalAuditEvent): Promise<unknown> {
    return client.query(`INSERT INTO audit_events(event_id,occurred_at,event_type,server_instance_id,session_id,
      request_id,capability_id,status,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [event.eventId, event.occurredAt, event.eventType, this.serverInstanceId, event.sessionId || null,
      event.requestId || null, event.capabilityId || null, event.status, event.reason ?? null]);
  }
  private async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
    try { const result = await this.pool.query<T>(sql, [...values]); this.connected = true; return result; }
    catch (error) { this.connected = false; throw error; }
  }
  private async transaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await work(client); await client.query("COMMIT"); this.connected = true; }
    catch (error) { await client.query("ROLLBACK"); this.connected = false; throw error; }
    finally { client.release(); }
  }
}
