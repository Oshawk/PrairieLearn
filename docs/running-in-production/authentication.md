# Authentication

PrairieLearn currently has a few ways to do user authentication.

- [Local username/password](#local-usernamepassword)
- [Google OAuth 2](#google-oauth-2)
- [LTI](../courseInstance/index.md#lti-overview)

## Local username/password

Local authentication lets an instructor maintain a small set of accounts directly inside PrairieLearn — no external identity provider required. Accounts are managed from the command line. There is no public sign-up page, no password reset flow, and no instructor UI: this is intentionally minimal, and is intended for self-hosted deployments where you control who can log in.

### Enable the provider

Set `hasLocalAuth` to `true` in `config.json`:

```json title="config.json"
{
  "hasLocalAuth": true
}
```

After restarting the server, a username and password form appears on `/pl/login` alongside any other configured providers.

### Manage accounts with the CLI

The `local-auth` script lives in the `prairielearn` workspace and is invoked via Yarn:

```sh
yarn workspace @prairielearn/prairielearn local-auth <command> [options]
```

Available commands:

| Command                                            | Description                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `add-user <uid> --name <name> [--uin] [--email]`   | Create or update the user, then set their password.                      |
| `set-password <uid>`                               | Update the password for an existing user.                                |
| `delete-user <uid>`                                | Remove the user's local credentials. The user row in `users` is kept.    |
| `list-users`                                       | List all users that have local credentials.                              |
| `import <file.json>`                               | Bulk-create or update users from a JSON file (see [Bulk import](#bulk-import)). |

The `<uid>` is the value the user will type in the **Username** field. It is also stored as the user's `email` if `--email` is not provided. Use an email-shaped string (e.g. `alice@example.com`) so it matches the Default institution's identity rules.

### Supplying the password

The CLI **never** accepts the password as a command-line argument (which would leak it via shell history and `ps`). Instead, it picks the first of these that is available:

1. **`--password-stdin`** — read the password from stdin. The newline at the end is stripped. Recommended for scripts and Docker entrypoints.

   ```sh
   echo "$STUDENT_PASSWORD" | yarn workspace @prairielearn/prairielearn local-auth \
     add-user alice@example.com --name "Alice" --password-stdin
   ```

2. **`LOCAL_AUTH_PASSWORD` environment variable** — useful when stdin is not free.

   ```sh
   LOCAL_AUTH_PASSWORD="$STUDENT_PASSWORD" yarn workspace @prairielearn/prairielearn local-auth \
     add-user alice@example.com --name "Alice"
   ```

3. **Interactive prompt** — only when the CLI is attached to a TTY. The terminal echo is disabled while typing.

   ```sh
   yarn workspace @prairielearn/prairielearn local-auth add-user alice@example.com --name "Alice"
   # Password: ****
   ```

If none of the above is available (e.g. running in CI with stdin closed and no env var), the CLI exits with a non-zero status and a clear error rather than creating an account with an empty password.

### Bulk import

For one-shot provisioning (e.g. baking accounts into a Docker image), provide a JSON file:

```json title="users.json"
[
  { "uid": "alice@example.com", "name": "Alice", "password": "hunter2" },
  { "uid": "bob@example.com", "name": "Bob", "password": "correcthorse", "uin": "12345" }
]
```

```sh
yarn workspace @prairielearn/prairielearn local-auth import users.json
```

Because this file contains plaintext passwords:

- Restrict its permissions before running (`chmod 600 users.json`). The CLI prints a warning if the file is readable by other users.
- Delete the file after the import succeeds.

### Security notes

- Passwords are hashed with Node's built-in [scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) (N=32768, r=8, p=1, 16-byte salt, 64-byte key) and verified in constant time.
- The login form returns the same generic "Invalid username or password" error whether the username is unknown or the password is wrong, to avoid user enumeration.
- The login form is CSRF-protected using PrairieLearn's standard signed-token mechanism.
- Local accounts live in the **Default** institution. They share the regular session, audit, and authorization machinery, so granting administrator status works the same way as for any other provider — see [Admin User Setup](admin-user.md).
- Removing credentials with `delete-user` does **not** delete the underlying `users` row; this preserves foreign-key relationships and the audit trail. The user simply can no longer log in via the local provider.

## Google OAuth 2

To start, create a [Google Cloud account](https://cloud.google.com/) and then:

- Click [console](https://console.cloud.google.com/) to log in to your console.
- Create a project then got to [APIs & Services](https://console.cloud.google.com/apis/dashboard).
  - Go to `OAuth consent screen` and complete the consent form.
  - Proceed to `Credentials` and create a new `OAuth client ID`.
  - Select `Web application`.
  - Under Authorized JavaScript origins, click `ADD URI` and add your domain.
  - Under Authorized redirect URIs, click `ADD URI` and add `https://yourdomain.com/pl/oauth2callback` which is the route to the Google OAuth callback.
  - Click `Create` which will give you a `Client ID` and a `Client Secret`. **Keep these values secret.**

Now add the keys to `config.json`:

```json title="config.json"
{
  "googleClientId": "Your Client ID key",
  "googleClientSecret": "Your Client Secret key",
  "googleRedirectUrl": "https://yourdomain.com/pl/oauth2callback",
  "hasOauth": true
}
```

You should now be able to use Google to log in to your PrairieLearn instance.

## LTI

Check out the [course instance LTI docs](../courseInstance/index.md#lti-overview) to learn more about LTI.
