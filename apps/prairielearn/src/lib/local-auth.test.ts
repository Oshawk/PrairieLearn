import { assert, describe, it } from 'vitest';

import { hashPassword, verifyPassword } from './local-auth.js';

describe('local-auth', () => {
  describe('hashPassword / verifyPassword', () => {
    it('verifies the correct password', async () => {
      const hash = await hashPassword('hunter2');
      assert.isTrue(await verifyPassword('hunter2', hash));
    });

    it('rejects the wrong password', async () => {
      const hash = await hashPassword('hunter2');
      assert.isFalse(await verifyPassword('hunter3', hash));
    });

    it('produces a different hash each call (random salt)', async () => {
      const a = await hashPassword('same-password');
      const b = await hashPassword('same-password');
      assert.notEqual(a, b);
      assert.isTrue(await verifyPassword('same-password', a));
      assert.isTrue(await verifyPassword('same-password', b));
    });

    it('encodes parameters in a recognizable format', async () => {
      const hash = await hashPassword('x');
      assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    });

    it('rejects malformed encoded hashes', async () => {
      assert.isFalse(await verifyPassword('x', 'not-a-hash'));
      assert.isFalse(await verifyPassword('x', 'scrypt$abc$8$1$xx$yy'));
      assert.isFalse(await verifyPassword('x', 'bcrypt$1$2$3$4$5'));
    });
  });
});
