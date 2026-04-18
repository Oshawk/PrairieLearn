CREATE TABLE IF NOT EXISTS local_auth_credentials (
  user_id BIGINT PRIMARY KEY REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO
  authn_providers (id, name)
VALUES
  (7, 'Local')
ON CONFLICT DO NOTHING;

SELECT
  setval(
    'authn_providers_id_seq',
    (
      SELECT
        MAX(id)
      FROM
        authn_providers
    ),
    true
  );

INSERT INTO
  institution_authn_providers (institution_id, authn_provider_id)
VALUES
  (
    1,
    (
      SELECT
        id
      FROM
        authn_providers
      WHERE
        name = 'Local'
    )
  )
ON CONFLICT DO NOTHING;
