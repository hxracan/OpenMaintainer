import { resolve } from 'node:path';
import { connect, migrate } from '../packages/database/src/index.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = connect(process.env.DATABASE_URL);
try {
  await migrate(db, resolve('packages/database/migrations/001_initial.sql'));
  console.log('Database migrations applied');
} finally {
  await db.close();
}
