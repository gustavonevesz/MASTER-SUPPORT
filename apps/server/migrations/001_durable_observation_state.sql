CREATE TABLE server_instances (
  server_instance_id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);

CREATE TABLE session_records (
  session_id uuid PRIMARY KEY,
  agent_instance_id uuid NOT NULL,
  protocol_version text NOT NULL,
  server_instance_id uuid NOT NULL REFERENCES server_instances(server_instance_id),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text,
  historical_status text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE observation_requests (
  request_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES session_records(session_id),
  server_instance_id uuid NOT NULL REFERENCES server_instances(server_instance_id),
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  created_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  state text NOT NULL,
  completed_at timestamptz,
  duration_ms integer,
  outcome_unknown boolean NOT NULL DEFAULT false,
  outcome_message_id uuid,
  failure_code text,
  failure_message text
);

CREATE TABLE evidence_metadata (
  evidence_id uuid PRIMARY KEY,
  observation_request_id uuid NOT NULL UNIQUE REFERENCES observation_requests(request_id),
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  collected_at timestamptz NOT NULL,
  source text NOT NULL,
  data_handling_state text NOT NULL,
  payload_size integer NOT NULL CHECK (payload_size >= 0)
);

CREATE TABLE observations (
  observation_id uuid PRIMARY KEY,
  observation_request_id uuid NOT NULL UNIQUE REFERENCES observation_requests(request_id),
  evidence_id uuid NOT NULL REFERENCES evidence_metadata(evidence_id),
  observed_at timestamptz NOT NULL,
  kind text NOT NULL,
  statement text NOT NULL,
  data_handling_state text NOT NULL,
  facts jsonb NOT NULL
);

CREATE TABLE audit_events (
  event_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  server_instance_id uuid NOT NULL REFERENCES server_instances(server_instance_id),
  session_id uuid,
  request_id uuid,
  capability_id text,
  status text NOT NULL,
  reason text
);

CREATE INDEX session_records_server_open_idx ON session_records (server_instance_id) WHERE ended_at IS NULL;
CREATE INDEX session_records_created_idx ON session_records (created_at);
CREATE INDEX observation_requests_session_idx ON observation_requests (session_id, created_at);
CREATE INDEX observation_requests_server_active_idx ON observation_requests (server_instance_id, state)
  WHERE state IN ('created', 'accepted', 'executing');
CREATE INDEX observations_observed_idx ON observations (observed_at);
CREATE INDEX audit_events_session_time_idx ON audit_events (session_id, occurred_at);
CREATE INDEX audit_events_request_time_idx ON audit_events (request_id, occurred_at);
