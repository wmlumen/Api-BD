import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export async function seed(knex) {
  // Deletes ALL existing entries
  await knex('query_history').del();
  await knex('api_keys').del();
  await knex('project_databases').del();
  await knex('user_projects').del();
  await knex('projects').del();
  await knex('users').del();

  // Create admin user
  const adminId = uuidv4();
  const adminPassword = await bcrypt.hash('admin123', 10);
  
  await knex('users').insert([
    {
      id: adminId,
      email: 'admin@example.com',
      document_id: '12345678',
      password_hash: adminPassword,
      first_name: 'Admin',
      last_name: 'User',
      is_active: true,
      email_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  // Create test user
  const testUserId = uuidv4();
  const testUserPassword = await bcrypt.hash('user123', 10);
  
  await knex('users').insert([
    {
      id: testUserId,
      email: 'user@example.com',
      document_id: '87654321',
      password_hash: testUserPassword,
      first_name: 'Test',
      last_name: 'User',
      is_active: true,
      email_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  // Create a sample project
  const projectId = uuidv4();
  await knex('projects').insert([
    {
      id: projectId,
      name: 'Demo Project',
      slug: 'demo-project',
      description: 'A sample project for demonstration purposes',
      is_public: true,
      is_active: true,
      created_by: adminId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  // Add users to the project
  await knex('user_projects').insert([
    {
      id: uuidv4(),
      user_id: adminId,
      project_id: projectId,
      role: 'admin',
      added_by: adminId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      user_id: testUserId,
      project_id: projectId,
      role: 'editor',
      added_by: adminId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  // Add a sample database connection
  await knex('project_databases').insert([
    {
      id: uuidv4(),
      project_id: projectId,
      name: 'Primary Database',
      description: 'Main database for the demo project',
      type: 'postgresql',
      is_primary: true,
      is_active: true,
      created_by: adminId,
      connection_config: JSON.stringify({
        host: 'localhost',
        port: 5432,
        database: 'demo_db',
        username: 'postgres',
        password: 'postgres',
        ssl: false,
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  // Create an API key for testing
  const apiKeyId = uuidv4();
  const apiKey = 'demo_' + Buffer.from(apiKeyId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  const apiKeyHash = await bcrypt.hash(apiKey, 10);
  
  await knex('api_keys').insert([
    {
      id: apiKeyId,
      name: 'Demo API Key',
      key_hash: apiKeyHash,
      user_id: adminId,
      project_id: projectId,
      permissions: JSON.stringify({
        read: true,
        write: true,
        delete: false,
        admin: false,
      }),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);

  console.log('\n=== Seeding completed successfully ===');
  console.log('Admin credentials:');
  console.log('  Email: admin@example.com');
  console.log('  Password: admin123');
  console.log('\nTest user credentials:');
  console.log('  Email: user@example.com');
  console.log('  Password: user123');
  console.log('\nAPI Key (save this, it will not be shown again):');
  console.log(`  ${apiKey}\n`);
}
