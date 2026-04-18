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

-- BLOCK grant_administrator
INSERT INTO
  administrators (user_id)
VALUES
  ($user_id)
ON CONFLICT DO NOTHING;

-- BLOCK enroll_in_all_course_instances
INSERT INTO
  enrollments (user_id, course_instance_id, status, first_joined_at)
SELECT
  $user_id,
  ci.id,
  'joined',
  CURRENT_TIMESTAMP
FROM
  course_instances AS ci
  LEFT JOIN enrollments AS e ON (
    e.user_id = $user_id
    AND e.course_instance_id = ci.id
  )
WHERE
  ci.deleted_at IS NULL
  AND e.id IS NULL;

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
