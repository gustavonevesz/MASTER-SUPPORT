ALTER TABLE operators DROP CONSTRAINT operators_role_check;
ALTER TABLE operators ADD CONSTRAINT operators_role_check
  CHECK (role IS NULL OR role IN ('OperatorReader','OperatorTechnician'));

CREATE TABLE action_requests (
  action_request_id uuid PRIMARY KEY,
  requested_by uuid NOT NULL REFERENCES operators(operator_id),
  action_id text NOT NULL,
  action_version text NOT NULL,
  target_kind text NOT NULL,
  input jsonb NOT NULL,
  idempotency_key_hash text NOT NULL CHECK (char_length(idempotency_key_hash) = 64),
  request_hash text NOT NULL CHECK (char_length(request_hash) = 64),
  requested_at timestamptz NOT NULL,
  UNIQUE(requested_by,idempotency_key_hash)
);

CREATE TABLE jobs (
  job_id uuid PRIMARY KEY,
  action_request_id uuid NOT NULL UNIQUE REFERENCES action_requests(action_request_id),
  status text NOT NULL CHECK (status IN ('Requested','AwaitingApproval','Ready','Executing','Verifying','Succeeded','Failed','Denied','Cancelled','Expired','OutcomeUnknown')),
  risk text NOT NULL CHECK (risk IN ('R0','R1','R2','R3','R4')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX jobs_status_updated_idx ON jobs(status,updated_at DESC);

CREATE TABLE policy_evaluations (
  policy_evaluation_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(job_id),
  policy_version text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('Allow','RequireApproval','Deny')),
  reason_codes jsonb NOT NULL,
  risk text NOT NULL CHECK (risk IN ('R0','R1','R2','R3','R4')),
  evaluated_at timestamptz NOT NULL
);

CREATE TABLE approval_requests (
  approval_request_id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(job_id),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('Pending','Approved','Denied','Expired','Cancelled')),
  CHECK (expires_at > requested_at)
);

CREATE TABLE approval_decisions (
  approval_decision_id uuid PRIMARY KEY,
  approval_request_id uuid NOT NULL UNIQUE REFERENCES approval_requests(approval_request_id),
  decided_by uuid NOT NULL REFERENCES operators(operator_id),
  decision text NOT NULL CHECK (decision IN ('Approved','Denied')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  self_approval boolean NOT NULL,
  decided_at timestamptz NOT NULL
);

CREATE TABLE execution_attempts (
  execution_attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(job_id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  executor_kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('Running','Succeeded','Failed','OutcomeUnknown')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome_code text,
  UNIQUE(job_id,attempt_number)
);

CREATE UNIQUE INDEX execution_attempts_one_active_idx ON execution_attempts(job_id) WHERE status='Running';

CREATE TABLE verification_attempts (
  verification_attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(job_id),
  execution_attempt_id uuid NOT NULL REFERENCES execution_attempts(execution_attempt_id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('Running','Passed','Failed','Inconclusive','OutcomeUnknown')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome_code text,
  UNIQUE(job_id,attempt_number)
);

CREATE UNIQUE INDEX verification_attempts_one_active_idx ON verification_attempts(job_id) WHERE status='Running';

CREATE TABLE job_events (
  sequence_id bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  job_id uuid NOT NULL REFERENCES jobs(job_id),
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  actor_operator_id uuid REFERENCES operators(operator_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX job_events_job_sequence_idx ON job_events(job_id,sequence_id);

CREATE TABLE action_security_events (
  event_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  job_id uuid REFERENCES jobs(job_id),
  operator_id uuid REFERENCES operators(operator_id),
  status text NOT NULL,
  reason text
);

CREATE INDEX action_security_events_time_idx ON action_security_events(occurred_at DESC);
