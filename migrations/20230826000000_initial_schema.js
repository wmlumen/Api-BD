exports.up = function(knex) {
  return knex.schema
    .createTable('users', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('email', 255).notNullable().unique();
      table.string('phone', 20).unique();
      table.string('document_id', 50).unique(); // cédula de identidad
      table.string('password_hash', 60).notNullable();
      table.string('first_name', 100);
      table.string('last_name', 100);
      table.boolean('is_active').defaultTo(true);
      table.boolean('email_verified').defaultTo(false);
      table.boolean('phone_verified').defaultTo(false);
      table.timestamp('last_login');
      table.timestamps(true, true);
      table.timestamp('deleted_at').nullable();
      
      // Indexes
      table.index(['email', 'is_active']);
      table.index(['phone', 'is_active']);
      table.index(['document_id', 'is_active']);
    })
    .createTable('projects', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name', 255).notNullable();
      table.string('slug', 255).notNullable().unique();
      table.text('description');
      table.string('logo_url', 500);
      table.boolean('is_public').defaultTo(false);
      table.boolean('is_active').defaultTo(true);
      table.jsonb('settings').defaultTo('{}');
      table.uuid('created_by').references('id').inTable('users');
      table.timestamps(true, true);
      table.timestamp('deleted_at').nullable();
      
      // Indexes
      table.index(['slug', 'is_active']);
      table.index(['created_by', 'is_active']);
    })
    .createTable('user_projects', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
      table.enum('role', ['user', 'editor', 'admin']).defaultTo('user');
      table.uuid('added_by').references('id').inTable('users');
      table.timestamps(true, true);
      
      // Composite unique constraint
      table.unique(['user_id', 'project_id']);
      
      // Indexes
      table.index(['user_id', 'role']);
      table.index(['project_id', 'role']);
    })
    .createTable('project_databases', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
      table.string('name', 100).notNullable();
      table.text('description');
      table.enum('type', ['postgresql', 'mysql', 'mongodb', 'sqlite', 'mssql']).notNullable();
      table.boolean('is_primary').defaultTo(false);
      table.boolean('is_active').defaultTo(true);
      table.jsonb('connection_config').notNullable();
      table.jsonb('metadata').defaultTo('{}');
      table.uuid('created_by').references('id').inTable('users');
      table.timestamps(true, true);
      table.timestamp('deleted_at').nullable();
      
      // Indexes
      table.index(['project_id', 'is_primary']);
      table.index(['project_id', 'is_active']);
    })
    .createTable('api_keys', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('name', 100).notNullable();
      table.string('key_hash', 255).notNullable().unique();
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
      table.jsonb('permissions').defaultTo('{}');
      table.timestamp('expires_at').nullable();
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
      
      // Indexes
      table.index(['user_id', 'is_active']);
      table.index(['project_id', 'is_active']);
    })
    .createTable('query_history', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE');
      table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
      table.uuid('database_id').references('id').inTable('project_databases').onDelete('SET NULL');
      table.text('query').notNullable();
      table.jsonb('params').defaultTo('{}');
      table.jsonb('result_metadata').defaultTo('{}');
      table.boolean('is_ai_generated').defaultTo(false);
      table.string('ai_model', 100);
      table.timestamps(true, true);
      
      // Indexes for performance
      table.index(['user_id', 'created_at']);
      table.index(['project_id', 'created_at']);
      table.index(['database_id', 'created_at']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('query_history')
    .dropTableIfExists('api_keys')
    .dropTableIfExists('project_databases')
    .dropTableIfExists('user_projects')
    .dropTableIfExists('projects')
    .dropTableIfExists('users');
};
