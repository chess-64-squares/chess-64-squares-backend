import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { ALL_ENTITIES } from './entities';
import { InitSchema1752200000000 } from '../migrations/1752200000000-InitSchema';
import { EmailVerification1752300000000 } from '../migrations/1752300000000-EmailVerification';
import { Puzzles1752400000000 } from '../migrations/1752400000000-Puzzles';

// CLI entrypoint for `typeorm migration:run` — app-local .env wins, with a
// parent-dir fallback (dotenv never overrides already-set variables)
loadDotenv({ path: join(__dirname, '..', '..', '.env') });
loadDotenv({ path: join(__dirname, '..', '..', '..', '.env') });
loadDotenv();

export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'chess64',
  password: process.env.POSTGRES_PASSWORD ?? 'chess64_dev_password',
  database: process.env.POSTGRES_DB ?? 'chess64',
  entities: ALL_ENTITIES,
  migrations: [InitSchema1752200000000, EmailVerification1752300000000, Puzzles1752400000000],
  synchronize: false,
  logging: ['error', 'migration'],
});
