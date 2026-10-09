ALTER TABLE session_records ADD COLUMN authenticated boolean NOT NULL DEFAULT false;

CREATE TABLE observed_endpoints (
  observed_endpoint_id uuid PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE REFERENCES session_records(session_id),
  observed_machine_name text,
  platform text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL
);

CREATE TABLE preflight_runs (
  preflight_run_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES session_records(session_id),
  server_instance_id uuid NOT NULL REFERENCES server_instances(server_instance_id),
  observed_endpoint_id uuid REFERENCES observed_endpoints(observed_endpoint_id),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('created','running','completed','partial','failed','cancelled','interrupted')),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  capability_failure_count integer NOT NULL DEFAULT 0 CHECK (capability_failure_count >= 0)
);

CREATE TABLE preflight_observations (
  preflight_run_id uuid NOT NULL REFERENCES preflight_runs(preflight_run_id),
  capability_id text NOT NULL,
  observation_request_id uuid NOT NULL REFERENCES observation_requests(request_id),
  PRIMARY KEY (preflight_run_id, capability_id),
  UNIQUE (preflight_run_id, observation_request_id)
);

CREATE TABLE preflight_snapshots (
  preflight_run_id uuid PRIMARY KEY REFERENCES preflight_runs(preflight_run_id),
  captured_at timestamptz NOT NULL,
  agent_version text,
  protocol_version text NOT NULL,
  completeness_percent integer NOT NULL CHECK (completeness_percent BETWEEN 0 AND 100),
  data_classification text NOT NULL CHECK (data_classification IN ('MINIMIZED','INTERNAL')),
  capability_versions jsonb NOT NULL,
  observation_ids jsonb NOT NULL
);

ALTER TABLE audit_events ADD COLUMN preflight_run_id uuid REFERENCES preflight_runs(preflight_run_id);
ALTER TABLE audit_events ADD COLUMN observed_endpoint_id uuid REFERENCES observed_endpoints(observed_endpoint_id);

CREATE INDEX preflight_runs_session_time_idx ON preflight_runs(session_id, created_at);
CREATE INDEX preflight_runs_server_active_idx ON preflight_runs(server_instance_id, status) WHERE status IN ('created','running');
CREATE INDEX preflight_observations_request_idx ON preflight_observations(observation_request_id);
