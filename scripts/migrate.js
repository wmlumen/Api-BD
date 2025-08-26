#!/usr/bin/env node
import knex from 'knex';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'multiproyecto',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  migrations: {
    directory: path.join(__dirname, '../migrations'),
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: path.join(__dirname, '../seeds'),
  },
};

// Parse command line arguments
const command = process.argv[2];
const db = knex(config);

async function runMigrations() {
  try {
    console.log('Running migrations...');
    await db.migrate.latest();
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    process.exit(1);
  }
}

async function rollbackMigrations() {
  try {
    console.log('Rolling back migrations...');
    await db.migrate.rollback();
    console.log('Rollback completed successfully');
  } catch (error) {
    console.error('Error rolling back migrations:', error);
    process.exit(1);
  }
}

async function createMigration(name) {
  try {
    console.log(`Creating migration: ${name}`);
    await db.migrate.make(name, {
      directory: path.join(__dirname, '../migrations'),
    });
    console.log(`Migration ${name} created successfully`);
  } catch (error) {
    console.error('Error creating migration:', error);
    process.exit(1);
  }
}

async function seedDatabase() {
  try {
    console.log('Running seeds...');
    await db.seed.run();
    console.log('Seeds completed successfully');
  } catch (error) {
    console.error('Error running seeds:', error);
    process.exit(1);
  }
}

// Execute the appropriate command
switch (command) {
  case 'up':
    await runMigrations();
    break;
  case 'down':
    await rollbackMigrations();
    break;
  case 'make':
    await createMigration(process.argv[3] || 'new_migration');
    break;
  case 'seed':
    await seedDatabase();
    break;
  case 'latest':
  default:
    await runMigrations();
    await seedDatabase();
    break;
}

// Close the database connection
await db.destroy();
process.exit(0);
