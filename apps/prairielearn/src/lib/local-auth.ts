import { promisify } from 'node:util';
import {
  randomBytes as randomBytesCb,
  scrypt as scryptCb,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';
import { DateFromISOString, IdSchema } from '@prairielearn/zod';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const randomBytes = promisify(randomBytesCb);

const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const SelectCredentialsByUidSchema = z.object({
  user_id: IdSchema,
  uid: z.string(),
  name: z.string().nullable(),
  password_hash: z.string(),
});

const ListCredentialsSchema = z.object({
  user_id: IdSchema,
  uid: z.string(),
  name: z.string().nullable(),
  updated_at: DateFromISOString,
});

export async function hashPassword(password: string): Promise<string> {
  const salt = await randomBytes(SCRYPT_SALT_BYTES);
  const key = (await scrypt(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }

  const computed = (await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export interface VerifiedLocalUser {
  user_id: string;
  uid: string;
  name: string | null;
}

export async function verifyLocalCredentials({
  uid,
  password,
}: {
  uid: string;
  password: string;
}): Promise<VerifiedLocalUser | null> {
  const row = await sqldb.queryOptionalRow(
    sql.select_credentials_by_uid,
    { uid },
    SelectCredentialsByUidSchema,
  );
  if (!row) {
    // Run a dummy hash to keep timing roughly constant against user enumeration.
    await scrypt(password, Buffer.alloc(SCRYPT_SALT_BYTES), SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
    return null;
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  return { user_id: row.user_id, uid: row.uid, name: row.name };
}

export async function setLocalCredentials({
  user_id,
  password,
}: {
  user_id: string | number;
  password: string;
}): Promise<void> {
  const password_hash = await hashPassword(password);
  await sqldb.execute(sql.upsert_credentials, { user_id, password_hash });
}

export async function deleteLocalCredentialsByUid(uid: string): Promise<boolean> {
  const rows = await sqldb.queryRows(
    sql.delete_credentials_by_uid,
    { uid },
    z.object({ user_id: IdSchema }),
  );
  return rows.length > 0;
}

export async function listLocalCredentials() {
  return sqldb.queryRows(sql.list_credentials, ListCredentialsSchema);
}

export async function selectUserIdByUid(uid: string): Promise<string | null> {
  const row = await sqldb.queryOptionalRow(
    sql.select_user_id_by_uid,
    { uid },
    z.object({ user_id: IdSchema }),
  );
  return row?.user_id ?? null;
}

export async function upsertLocalUser({
  uid,
  name,
  uin,
  email,
}: {
  uid: string;
  name: string;
  uin: string | null;
  email: string | null;
}): Promise<string> {
  const row = await sqldb.queryRow(
    sql.upsert_user,
    { uid, name, uin, email },
    z.object({ user_id: IdSchema }),
  );
  return row.user_id;
}

export interface LocalAuthUserSpec {
  uid: string;
  name: string;
  password: string;
  uin?: string | null;
  email?: string | null;
  admin?: boolean;
  enroll?: boolean;
}

export async function provisionLocalAuthUsers(specs: LocalAuthUserSpec[]): Promise<void> {
  for (const spec of specs) {
    const user_id = await upsertLocalUser({
      uid: spec.uid,
      name: spec.name,
      uin: spec.uin ?? null,
      email: spec.email ?? spec.uid,
    });
    await setLocalCredentials({ user_id, password: spec.password });
    if (spec.admin) {
      await sqldb.execute(sql.grant_administrator, { user_id });
    }
    if (spec.enroll) {
      await sqldb.execute(sql.enroll_in_all_course_instances, { user_id });
    }
  }
}
