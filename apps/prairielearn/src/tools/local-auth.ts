#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

import minimist from 'minimist';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { config, loadConfig } from '../lib/config.js';
import {
  deleteLocalCredentialsByUid,
  listLocalCredentials,
  selectUserIdByUid,
  setLocalCredentials,
  upsertLocalUser,
} from '../lib/local-auth.js';
import { APP_ROOT_PATH } from '../lib/paths.js';

const USAGE = `\
Manage local username/password credentials for PrairieLearn.

Usage:
  yarn workspace @prairielearn/prairielearn local-auth <command> [options]

Commands:
  add-user <uid> --name <name> [--uin <uin>] [--email <email>] [--password-stdin]
  set-password <uid> [--password-stdin]
  delete-user <uid>
  list-users
  import <file.json>

Password input (for add-user, set-password, and import):
  --password-stdin                Read password from stdin (e.g. echo "$PW" | ... --password-stdin)
  LOCAL_AUTH_PASSWORD env var     Read password from this environment variable
  Interactive (TTY only)          Prompt with echo disabled

Exit codes: 0 success, 1 user error, 2 credential/DB failure.
`;

function err(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

async function readPassword({ passwordStdin }: { passwordStdin: boolean }): Promise<string> {
  if (passwordStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    let text = Buffer.concat(chunks).toString('utf8');
    if (text.endsWith('\r\n')) text = text.slice(0, -2);
    else if (text.endsWith('\n')) text = text.slice(0, -1);
    if (!text) err('--password-stdin produced an empty password');
    return text;
  }

  const envPassword = process.env.LOCAL_AUTH_PASSWORD;
  if (envPassword !== undefined && envPassword !== '') return envPassword;

  if (!process.stdin.isTTY) {
    err(
      'no password supplied; pass --password-stdin, set LOCAL_AUTH_PASSWORD, or run interactively (TTY)',
    );
  }

  return await promptPassword('Password: ');
}

async function promptPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return await new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    let buffer = '';
    const onData = (data: Buffer) => {
      const s = data.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          if (typeof stdin.setRawMode === 'function') stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(buffer);
          return;
        } else if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        } else if (ch === '\u007f' || ch === '\b') {
          buffer = buffer.slice(0, -1);
        } else {
          buffer += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function ensureUser({
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
  return await upsertLocalUser({ uid, name, uin, email: email ?? uid });
}

async function withDatabase(fn: () => Promise<void>): Promise<void> {
  const configPaths = [
    path.join(APP_ROOT_PATH, 'config.json'),
    path.join(process.cwd(), 'config.json'),
  ];
  if (process.env.PL_CONFIG_PATH) configPaths.unshift(process.env.PL_CONFIG_PATH);

  await loadConfig(configPaths.filter((p) => fs.existsSync(p)));

  await sqldb.initAsync(
    {
      user: config.postgresqlUser,
      database: config.postgresqlDatabase,
      host: config.postgresqlHost,
      password: config.postgresqlPassword ?? undefined,
      max: 2,
      idleTimeoutMillis: 5000,
      ssl: config.postgresqlSsl,
    },
    (e) => {
      throw e;
    },
  );

  try {
    await fn();
  } finally {
    await sqldb.closeAsync();
  }
}

const ImportEntrySchema = z.object({
  uid: z.string().min(1),
  name: z.string().min(1),
  uin: z.string().nullable().optional().default(null),
  email: z.string().nullable().optional().default(null),
  password: z.string().min(1),
});
const ImportFileSchema = z.array(ImportEntrySchema);

async function cmdAddUser(argv: minimist.ParsedArgs) {
  const uid = argv._[1];
  const name = argv.name as string | undefined;
  if (!uid) err('add-user: <uid> is required');
  if (!name) err('add-user: --name is required');

  const password = await readPassword({ passwordStdin: argv['password-stdin'] === true });

  await withDatabase(async () => {
    const user_id = await ensureUser({
      uid,
      name,
      uin: (argv.uin as string | undefined) ?? null,
      email: (argv.email as string | undefined) ?? null,
    });
    await setLocalCredentials({ user_id, password });
    process.stdout.write(`Added local credentials for ${uid} (user_id=${user_id}).\n`);
  });
}

async function cmdSetPassword(argv: minimist.ParsedArgs) {
  const uid = argv._[1];
  if (!uid) err('set-password: <uid> is required');

  const password = await readPassword({ passwordStdin: argv['password-stdin'] === true });

  await withDatabase(async () => {
    const user_id = await selectUserIdByUid(uid);
    if (!user_id) {
      process.stderr.write(`error: no user with uid=${uid}\n`);
      process.exit(2);
    }
    await setLocalCredentials({ user_id, password });
    process.stdout.write(`Updated password for ${uid}.\n`);
  });
}

async function cmdDeleteUser(argv: minimist.ParsedArgs) {
  const uid = argv._[1];
  if (!uid) err('delete-user: <uid> is required');

  await withDatabase(async () => {
    const removed = await deleteLocalCredentialsByUid(uid);
    if (!removed) {
      process.stderr.write(`error: no local credentials found for ${uid}\n`);
      process.exit(2);
    }
    process.stdout.write(`Removed local credentials for ${uid}. (User row preserved.)\n`);
  });
}

async function cmdListUsers() {
  await withDatabase(async () => {
    const rows = await listLocalCredentials();
    if (rows.length === 0) {
      process.stdout.write('No local credentials.\n');
      return;
    }
    for (const row of rows) {
      process.stdout.write(
        `${row.uid}\t${row.name ?? ''}\tupdated=${row.updated_at.toISOString()}\n`,
      );
    }
  });
}

async function cmdImport(argv: minimist.ParsedArgs) {
  const file = argv._[1];
  if (!file) err('import: <file.json> is required');

  const stat = fs.statSync(file);
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    process.stderr.write(
      `warning: ${file} is readable by other users; chmod 600 it and delete after import\n`,
    );
  }

  const raw = fs.readFileSync(file, 'utf8');
  const entries = ImportFileSchema.parse(JSON.parse(raw));

  await withDatabase(async () => {
    for (const entry of entries) {
      const user_id = await ensureUser({
        uid: entry.uid,
        name: entry.name,
        uin: entry.uin,
        email: entry.email,
      });
      await setLocalCredentials({ user_id, password: entry.password });
      process.stdout.write(`Imported ${entry.uid} (user_id=${user_id}).\n`);
    }
    process.stdout.write(`Imported ${entries.length} user(s).\n`);
  });
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['password-stdin', 'help'],
    string: ['name', 'uin', 'email'],
    alias: { h: 'help' },
  });
  if (argv.help || argv._.length === 0) {
    process.stdout.write(USAGE);
    process.exit(argv.help ? 0 : 1);
  }

  const cmd = argv._[0];
  switch (cmd) {
    case 'add-user':
      await cmdAddUser(argv);
      break;
    case 'set-password':
      await cmdSetPassword(argv);
      break;
    case 'delete-user':
      await cmdDeleteUser(argv);
      break;
    case 'list-users':
      await cmdListUsers();
      break;
    case 'import':
      await cmdImport(argv);
      break;
    default:
      err(`unknown command: ${cmd}`);
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
