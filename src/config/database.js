import knex from 'knex';
import { knexSnakeCaseMappers } from 'objection';
import dotenv from 'dotenv';

dotenv.config();

const environment = process.env.NODE_ENV || 'development';

// Database configuration
const config = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'multiproyecto',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    },
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations',
    },
    seeds: {
      directory: './seeds',
    },
    ...knexSnakeCaseMappers(),
  },
  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL || {
      host: process.env.TEST_DB_HOST || 'localhost',
      port: process.env.TEST_DB_PORT || 5432,
      database: process.env.TEST_DB_NAME || 'multiproyecto_test',
      user: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'postgres',
    },
    ...knexSnakeCaseMappers(),
  },
  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: './migrations',
    },
    ...knexSnakeCaseMappers(),
  },
};

const dbConfig = config[environment];

// Initialize knex
export const knexInstance = knex(dbConfig);

// Test the connection unless explicitly skipped (tests, health checks, docs)
const shouldSkipTest = process.env.NODE_ENV === 'test' || process.env.SKIP_DB_INIT === 'true';
if (!shouldSkipTest) {
  knexInstance.raw('SELECT 1')
    .then(() => {
      console.log('Database connection successful');
    })
    .catch((err) => {
      console.error('Database connection failed:', err);
      // Do not hard-exit in serverless cold start; rethrow to let caller handle
      // but in traditional server start, exiting is acceptable
      if (process.env.VERCEL !== '1') {
        process.exit(1);
      }
      throw err;
    });
}

export default knexInstance;
