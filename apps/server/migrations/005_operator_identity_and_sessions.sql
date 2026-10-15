CREATE TABLE operators (
  operator_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 100),
  provider_subject text NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 500),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('Active','Disabled')),
  role text CHECK (role IS NULL OR role = 'OperatorReader'),
  created_at timestamptz NOT NULL,
  last_authenticated_at timestamptz,
  UNIQUE(provider, provider_subject)
);

CREATE TABLE operator_sessions (
  operator_session_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES operators(operator_id),
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  CHECK (last_seen_at >= created_at),
  CHECK (idle_expires_at > created_at),
  CHECK (absolute_expires_at > created_at)
);

CREATE INDEX operator_sessions_operator_active_idx
  ON operator_sessions(operator_id) WHERE ended_at IS NULL AND revoked_at IS NULL;

CREATE TABLE operator_security_events (
  event_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  operator_id uuid REFERENCES operators(operator_id),
  operator_session_id uuid REFERENCES operator_sessions(operator_session_id),
  provider text,
  status text NOT NULL,
  reason text,
  source_address_hash text
);

CREATE INDEX operator_security_events_time_idx ON operator_security_events(occurred_at DESC);
