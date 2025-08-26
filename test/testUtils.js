const knex = require('knex');
const config = require('../knexfile');

// Use test configuration
const testConfig = {
  ...config,
  connection: {
    ...config.connection,
    database: 'test_db' // Make sure this matches your test database name
  },
  migrations: {
    directory: './migrations'
  },
  seeds: {
    directory: './seeds/test'
  }
};

// Create a test database connection
const testKnex = knex(testConfig);

/**
 * Set up the test database
 */
async function setupDatabase() {
  // Run migrations
  await testKnex.migrate.latest();
  
  // Run seeds if any
  try {
    await testKnex.seed.run();
  } catch (error) {
    console.warn('No test seeds found or error running seeds:', error.message);
  }
}

/**
 * Tear down the test database
 */
async function teardownDatabase() {
  // Rollback all migrations
  await testKnex.migrate.rollback({}, true);
  
  // Destroy the connection
  await testKnex.destroy();
}

module.exports = {
  testKnex,
  setupDatabase,
  teardownDatabase
};
