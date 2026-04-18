-- BLOCK select_credentials_by_uid
SELECT
  u.id AS user_id,
  u.uid,
  u.name,
  c.password_hash
FROM
  users AS u
  JOIN local_auth_credentials AS c ON (c.user_id = u.id)
WHERE
  u.uid = $uid
  AND u.deleted_at IS NULL;

-- BLOCK upsert_credentials
INSERT INTO
  local_auth_credentials (user_id, password_hash, updated_at)
VALUES
  ($user_id, $password_hash, CURRENT_TIMESTAMP)
ON CONFLICT (user_id) DO UPDATE
SET
  password_hash = EXCLUDED.password_hash,
  updated_at = CURRENT_TIMESTAMP;

-- BLOCK delete_credentials_by_uid
DELETE FROM local_auth_credentials
WHERE
  user_id = (
    SELECT
      id
    FROM
      users
    WHERE
      uid = $uid
  )
RETURNING
  user_id;

-- BLOCK upsert_user
INSERT INTO
  users (uid, name, uin, email, institution_id)
VALUES
  ($uid, $name, $uin, $email, 1)
ON CONFLICT (uid) DO UPDATE
SET
  name = COALESCE(EXCLUDED.name, users.name),
  uin = COALESCE(EXCLUDED.uin, users.uin),
  email = COALESCE(EXCLUDED.email, users.email)
RETURNING
  id AS user_id;

-- BLOCK select_user_id_by_uid
SELECT
  id AS user_id
FROM
  users
WHERE
  uid = $uid
  AND deleted_at IS NULL;

-- BLOCK list_credentials
SELECT
  u.id AS user_id,
  u.uid,
  u.name,
  c.updated_at
FROM
  local_auth_credentials AS c
  JOIN users AS u ON (u.id = c.user_id)
WHERE
  u.deleted_at IS NULL
ORDER BY
  u.uid;
