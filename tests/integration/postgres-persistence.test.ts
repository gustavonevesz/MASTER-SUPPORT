import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { PostgresPersistence } from "../../apps/server/src/persistence/postgres.js";
import type { ObservationRequestRecord, ObservationState } from "../../apps/server/src/observation/store.js";
import type { Session } from "../../apps/server/src/session/session.js";

const terminalStates: ObservationState[] = ["failed", "timed_out", "cancelled", "abandoned"];

test("test database guard rejects non-PostgreSQL, remote, and non-dedicated databases", () => {
  assert.throws(() => requireSafeTestDatabase("sqlite:///master_support_test"), /postgresql/);
  assert.throws(() => requireSafeTestDatabase("postgresql://user@example.com/master_support_test"), /host/);
  assert.throws(() => requireSafeTestDatabase("postgresql://user@127.0.0.1/production"), /unsafe/);
});

test("empty database migrates, reapplies idempotently, and rejects a future schema", async () => isolated(async url => {
  const pool = new Pool({ connectionString: url });
  try {
    await assert.rejects(PostgresPersistence.start(url), /database_schema_is_not_migrated/);
    await migrate(pool); await migrate(pool);
    const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename");
    assert.deepEqual(tables.rows.map(row => row.tablename), ["action_requests","action_security_events","approval_decisions","approval_requests","asset_endpoint_links", "assets", "audit_events", "evidence_metadata","execution_attempts","job_events","jobs", "observation_requests",
      "observations", "observed_endpoints", "operator_security_events", "operator_sessions", "operators","policy_evaluations", "preflight_observations", "preflight_runs", "preflight_snapshots",
      "schema_migrations", "server_instances", "session_records", "support_invitations","verification_attempts"]);
    await pool.query("INSERT INTO schema_migrations(version,name,checksum) VALUES($1,$2,$3)", [999, "future.sql", "future"]);
    await assert.rejects(migrate(pool), /database_schema_is_newer/);
    await assert.rejects(PostgresPersistence.start(url), /database_schema_version_mismatch/);
  } finally { await pool.end(); }
}, false));

test("ServerInstance and SessionRecord persist history without runtime authority or resume token", async () => isolated(async url => {
  const persistence = await PostgresPersistence.start(url); const session = makeSession();
  try {
    await persistence.persistSessionCreated(session);
    const history = await persistence.sessionHistory(session.id);
    assert.equal(history?.["server_instance_id"], persistence.serverInstanceId);
    assert.equal(history?.["historical_status"], "active");
    assert.equal(JSON.stringify(history).includes("resume-secret-marker"), false);
    const pool = new Pool({ connectionString: url });
    try { const columns = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1", ["session_records"]);
      assert.equal(columns.rows.some(row => row.column_name === "resume_token"), false); }
    finally { await pool.end(); }
  } finally { await persistence.finish(); }
}));

test("completion atomically persists minimized Observation and EvidenceMetadata without RAW payload", async () => isolated(async url => {
  const persistence = await PostgresPersistence.start(url); const session = makeSession(); const record = makeRequest(session);
  try {
    await persistence.persistSessionCreated(session); await persistence.persistObservationBeforeDispatch(record);
    complete(record, "RAW_SECRET_MARKER"); await persistence.persistObservation(record, audit(record, "observation.completed"));
    const history = await persistence.observationHistory(record.requestId); const serialized = JSON.stringify(history);
    assert.equal(history?.["state"], "completed"); assert.equal(history?.["data_handling_state"], "MINIMIZED");
    assert.equal(history?.["evidence_data_handling_state"], "RAW"); assert.doesNotMatch(serialized, /RAW_SECRET_MARKER/);
    assert.match(serialized, /osPlatform/); assert.equal("payload" in (history ?? {}), false);
  } finally { await persistence.finish(); }
}));

test("failure timeout cancellation and durable outcomeUnknown remain distinct", async () => isolated(async url => {
  const persistence = await PostgresPersistence.start(url); const session = makeSession();
  try {
    await persistence.persistSessionCreated(session);
    for (const state of terminalStates) {
      const record = makeRequest(session); await persistence.persistObservationBeforeDispatch(record);
      record.state = state; record.completedAt = new Date().toISOString(); record.failure = { code: state, message: "known metadata only" };
      if (state === "abandoned") record.outcomeUnknown = true;
      await persistence.persistObservation(record, audit(record, `observation.${state}`));
      const history = await persistence.observationHistory(record.requestId);
      assert.equal(history?.["state"], state); assert.equal(history?.["outcome_unknown"], state === "abandoned");
    }
  } finally { await persistence.finish(); }
}));

test("restart reconciliation abandons prior work, interrupts historical Session, and never creates live authority", async () => isolated(async url => {
  const first = await PostgresPersistence.start(url); const session = makeSession(); const record = makeRequest(session);
  await first.persistSessionCreated(session); await first.persistObservationBeforeDispatch(record);
  const second = await PostgresPersistence.start(url);
  try {
    const reconciled = await second.reconcileRestart();
    assert.deepEqual(reconciled, { sessions: 1, observations: 1 });
    const sessionHistory = await second.sessionHistory(session.id); const observation = await second.observationHistory(record.requestId);
    assert.equal(sessionHistory?.["historical_status"], "interrupted"); assert.equal(sessionHistory?.["end_reason"], "server_restart");
    assert.equal(observation?.["state"], "abandoned"); assert.equal(observation?.["outcome_unknown"], true);
    assert.equal(observation?.["failure_code"], "server_restart");
  } finally { await first.finish(); await second.finish(); }
}));

test("restart interrupts an in-flight Preflight without snapshot or automatic reexecution", async () => isolated(async url => {
  const first = await PostgresPersistence.start(url); const session = makeSession();
  await first.persistSessionCreated(session);
  const preflightRunId=crypto.randomUUID(); await first.persistPreflightStarted({preflightRunId,sessionId:session.id,
    createdAt:new Date().toISOString(),startedAt:new Date().toISOString(),status:"running",capabilityFailureCount:0,
    requestIds:[],observationIds:[],capabilityResults:[]});
  const second=await PostgresPersistence.start(url);
  try { await second.reconcileRestart(); const history=await second.preflightHistory(preflightRunId);
    assert.equal(history?.["status"],"interrupted");assert.equal(history?.["captured_at"],null);const runs=await second.listPreflightHistory(session.id);
    assert.equal(runs.length,1);assert.equal(runs[0]?.["status"],"interrupted");
    const pool=new Pool({connectionString:url});try{const count=await pool.query<{count:string}>("SELECT count(*)::text AS count FROM preflight_runs WHERE session_id=$1",[session.id]);assert.equal(count.rows[0]?.count,"1");}
    finally{await pool.end();}
  } finally { await first.finish(); await second.finish(); }
}));

test("clean restart preserves completed history and has nothing uncertain to reconcile", async () => isolated(async url => {
  const first = await PostgresPersistence.start(url); const session = makeSession(); const record = makeRequest(session);
  await first.persistSessionCreated(session); await first.persistObservationBeforeDispatch(record); complete(record);
  await first.persistObservation(record, audit(record, "observation.completed")); session.state = "closed";
  await first.persistSessionState(session, "server_shutdown"); await first.finish();
  const second = await PostgresPersistence.start(url);
  try { assert.deepEqual(await second.reconcileRestart(), { sessions: 0, observations: 0 });
    assert.equal((await second.observationHistory(record.requestId))?.["state"], "completed");
    assert.notEqual(second.serverInstanceId, first.serverInstanceId); }
  finally { await second.finish(); }
}));

test("late result is audit-only and cannot reopen a durable terminal request or persist RAW", async () => isolated(async url => {
  const persistence = await PostgresPersistence.start(url); const session = makeSession(); const record = makeRequest(session);
  try {
    await persistence.persistSessionCreated(session); await persistence.persistObservationBeforeDispatch(record);
    record.state = "cancelled"; record.completedAt = new Date().toISOString();
    await persistence.persistObservation(record, audit(record, "observation.cancelled"));
    complete(record, "LATE_RAW_SECRET_MARKER");
    await persistence.persistObservation(record, audit(record, "observation.late_result"));
    const history = await persistence.observationHistory(record.requestId);
    assert.equal(history?.["state"], "cancelled"); assert.equal(history?.["outcome_unknown"], false);
    assert.doesNotMatch(JSON.stringify(history), /LATE_RAW_SECRET_MARKER/);
    const pool = new Pool({ connectionString: url });
    try {
      const counts = await pool.query<{ evidence: string; observations: string; late_events: string }>(
        `SELECT (SELECT count(*) FROM evidence_metadata WHERE observation_request_id=$1)::text AS evidence,
                (SELECT count(*) FROM observations WHERE observation_request_id=$1)::text AS observations,
                (SELECT count(*) FROM audit_events WHERE request_id=$1 AND event_type='observation.late_result')::text AS late_events`,
        [record.requestId]);
      assert.deepEqual(counts.rows[0], { evidence: "0", observations: "0", late_events: "1" });
    } finally { await pool.end(); }
  } finally { await persistence.finish(); }
}));

test("restart after a possible result arrival but before its commit remains outcomeUnknown", async () => isolated(async url => {
  const first = await PostgresPersistence.start(url); const session = makeSession(); const record = makeRequest(session);
  await first.persistSessionCreated(session); await first.persistObservationBeforeDispatch(record);
  record.state = "executing"; await first.persistObservation(record, audit(record, "observation.executing"));
  complete(record, "RESULT_PRESENT_ONLY_IN_CRASHED_MEMORY");
  // The process dies in this controlled window: no result transaction reaches PostgreSQL.
  const second = await PostgresPersistence.start(url);
  try {
    assert.deepEqual(await second.reconcileRestart(), { sessions: 1, observations: 1 });
    const history = await second.observationHistory(record.requestId); const serialized = JSON.stringify(history);
    assert.equal(history?.["state"], "abandoned"); assert.equal(history?.["outcome_unknown"], true);
    assert.equal(history?.["evidence_id"], null); assert.equal(history?.["observation_id"], null);
    assert.doesNotMatch(serialized, /RESULT_PRESENT_ONLY_IN_CRASHED_MEMORY/);
  } finally { await first.finish(); await second.finish(); }
}));

test("parameterized history lookup treats hostile request id as data", async () => isolated(async url => {
  const persistence = await PostgresPersistence.start(url);
  try {
    await assert.rejects(persistence.observationHistory("' OR 1=1; DROP TABLE observation_requests; --"), /uuid/);
    const pool = new Pool({ connectionString: url });
    try { assert.equal((await pool.query("SELECT to_regclass('observation_requests') AS name")).rows[0]?.name, "observation_requests"); }
    finally { await pool.end(); }
  } finally { await persistence.finish(); }
}));

test("failed result transaction leaves request nonterminal and creates no partial Evidence or Observation", async () => isolated(async url => {
  const persistence = await PostgresPersistence.start(url); const session = makeSession(); const record = makeRequest(session);
  try {
    await persistence.persistSessionCreated(session); await persistence.persistObservationBeforeDispatch(record); complete(record);
    record.evidence!.evidenceId = "not-a-uuid";
    await assert.rejects(persistence.persistObservation(record, audit(record, "observation.completed")));
    const history = await persistence.observationHistory(record.requestId);
    assert.equal(history?.["state"], "created"); assert.equal(history?.["evidence_id"], null); assert.equal(history?.["observation_id"], null);
  } finally { await persistence.finish(); }
}));

async function isolated(work: (url: string) => Promise<void>, migrateFirst = true): Promise<void> {
  const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];
  if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required for PostgreSQL integration tests");
  requireSafeTestDatabase(configured);
  const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: configured });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`);
  try {
    if (migrateFirst) { const pool = new Pool({ connectionString: parsed.toString() }); try { await migrate(pool); } finally { await pool.end(); } }
    await work(parsed.toString());
  }
  finally {
    if (!/^ms_test_[a-f0-9]{32}$/.test(schema)) throw new Error("unsafe_test_schema_cleanup");
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
  }
}

function makeSession(): Session { const now = new Date(); return { id: crypto.randomUUID(), agentInstanceId: crypto.randomUUID(),
  protocolVersion: "1.0", capabilities: [{ id: "system.runtime.summary", version: "1.0" }], createdAt: now, lastSeenAt: now,
  expiresAt: new Date(now.getTime() + 10_000), state: "active", resumeToken: "resume-secret-marker", processedMessageIds: new Set(), messageOrder: [] }; }

function makeRequest(session: Session): ObservationRequestRecord { const now = new Date(); return { requestId: crypto.randomUUID(),
  sessionId: session.id, agentInstanceId: session.agentInstanceId, capabilityId: "system.runtime.summary", capabilityVersion: "1.0",
  createdAt: now.toISOString(), deadline: new Date(now.getTime() + 5_000).toISOString(), state: "created", lifecycle: ["created"], lateOutcomes: [] }; }

function complete(record: ObservationRequestRecord, secret?: string): void { const evidenceId = crypto.randomUUID(); const facts = {
  osPlatform: "Windows", osDescription: "Windows", osArchitecture: "x64", processArchitecture: "x64", dotnetRuntime: ".NET 10",
  agentVersion: "0.1.0", productVersion: "0.1.0", protocolVersion: "1.0", supportSessionMode: "temporary-development", secret };
  record.state = "completed"; record.completedAt = new Date().toISOString(); record.durationMs = 1;
  record.evidence = { evidenceId, capabilityId: record.capabilityId, capabilityVersion: record.capabilityVersion,
    collectedAt: new Date().toISOString(), source: "agent.dotnet.runtime", dataHandlingState: "RAW", payload: facts };
  record.observation = { observationId: crypto.randomUUID(), evidenceId, observedAt: new Date().toISOString(),
    kind: "runtime-summary-collected", statement: "The temporary Agent runtime has the reported platform and architecture properties.", facts }; }

function audit(record: ObservationRequestRecord, eventType: string) { return { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(),
  eventType, sessionId: record.sessionId, requestId: record.requestId, capabilityId: record.capabilityId, status: record.state }; }
