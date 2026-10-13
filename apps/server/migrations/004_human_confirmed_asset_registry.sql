CREATE TABLE assets (
  asset_id uuid PRIMARY KEY,
  asset_type text NOT NULL CHECK (asset_type = 'WindowsEndpoint'),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
  external_inventory_id text CHECK (external_inventory_id IS NULL OR char_length(btrim(external_inventory_id)) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('Active','Retired')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX assets_external_inventory_id_unique
  ON assets (lower(external_inventory_id)) WHERE external_inventory_id IS NOT NULL;

CREATE TABLE asset_endpoint_links (
  link_id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES assets(asset_id),
  observed_endpoint_id uuid NOT NULL REFERENCES observed_endpoints(observed_endpoint_id),
  confirmed_at timestamptz NOT NULL,
  confirmed_by text NOT NULL CHECK (confirmed_by = 'local_operator'),
  confirmation_method text NOT NULL CHECK (confirmation_method = 'HumanReview'),
  status text NOT NULL CHECK (status IN ('Active','Revoked')),
  revoked_at timestamptz,
  revoked_by text,
  revocation_reason text,
  CHECK ((status = 'Active' AND revoked_at IS NULL AND revoked_by IS NULL) OR
         (status = 'Revoked' AND revoked_at IS NOT NULL AND revoked_by = 'local_operator')),
  CHECK (revocation_reason IS NULL OR char_length(btrim(revocation_reason)) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX asset_endpoint_links_one_active_endpoint
  ON asset_endpoint_links (observed_endpoint_id) WHERE status = 'Active';
CREATE INDEX asset_endpoint_links_asset_time_idx ON asset_endpoint_links (asset_id, confirmed_at);
CREATE INDEX asset_endpoint_links_endpoint_time_idx ON asset_endpoint_links (observed_endpoint_id, confirmed_at);

ALTER TABLE audit_events ADD COLUMN asset_id uuid REFERENCES assets(asset_id);
ALTER TABLE audit_events ADD COLUMN asset_endpoint_link_id uuid REFERENCES asset_endpoint_links(link_id);
ALTER TABLE audit_events ADD COLUMN actor_type text CHECK (actor_type IS NULL OR actor_type = 'local_operator');
CREATE INDEX audit_events_asset_time_idx ON audit_events (asset_id, occurred_at);
