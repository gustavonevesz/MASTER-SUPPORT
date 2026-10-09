ALTER TABLE audit_events ALTER COLUMN server_instance_id DROP NOT NULL;

CREATE TABLE support_invitations (
  invitation_id uuid PRIMARY KEY,
  secret_hash bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  issuer text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  status text NOT NULL CHECK (status IN ('active','used','revoked','expired')),
  bound_agent_instance_id uuid,
  negotiated_capabilities jsonb,
  CHECK (expires_at > created_at)
);

ALTER TABLE audit_events ADD COLUMN invitation_id uuid REFERENCES support_invitations(invitation_id);

CREATE INDEX support_invitations_status_expiry_idx ON support_invitations(status, expires_at);
CREATE INDEX audit_events_invitation_idx ON audit_events(invitation_id, occurred_at);
