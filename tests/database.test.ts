import { expect, it } from 'vitest';
import { testDatabase } from './helpers/database.js';

it('migrates a real PostgreSQL engine and rolls back transactions', async () => {
  const db = await testDatabase();
  try {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO installations(id,account) VALUES(1,'demo')");
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await db.query('SELECT * FROM installations')).rows).toHaveLength(0);
    expect((await db.query('SELECT version FROM schema_migrations')).rows).toHaveLength(2);
  } finally {
    await db.close();
  }
});
