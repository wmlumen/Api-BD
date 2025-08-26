import { BaseModel } from './BaseModel.js';

export class ProjectDatabase extends BaseModel {
  static get tableName() {
    return 'project_databases';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['project_id', 'name', 'type', 'connection_config'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        project_id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        description: { type: ['string', 'null'], maxLength: 500 },
        type: { 
          type: 'string', 
          enum: ['postgresql', 'mysql', 'mongodb', 'sqlite', 'mssql'] 
        },
        is_primary: { type: 'boolean', default: false },
        is_active: { type: 'boolean', default: true },
        connection_config: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
            database: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
            ssl: { type: 'boolean', default: false },
            // Add other database-specific connection options
          },
          required: ['host', 'database', 'username', 'password'],
        },
        metadata: {
          type: 'object',
          default: {},
        },
        created_by: { type: 'string', format: 'uuid' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        deleted_at: { type: ['string', 'null'], format: 'date-time' },
      },
    };
  }

  static get relationMappings() {
    return {
      project: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: 'Project.js',
        join: {
          from: 'project_databases.project_id',
          to: 'projects.id',
        },
      },
      createdBy: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_databases.created_by',
          to: 'users.id',
        },
      },
    };
  }

  // Ensure only one primary database per project
  async $beforeInsert() {
    await super.$beforeInsert();
    
    if (this.is_primary) {
      // If this is set as primary, unset primary flag from other databases in the project
      await this.constructor.query()
        .where('project_id', this.project_id)
        .where('is_primary', true)
        .patch({ is_primary: false });
    }
  }

  async $beforeUpdate() {
    await super.$beforeUpdate();
    
    if (this.is_primary && this.is_primary !== this.$before.is_primary) {
      // If this is being set as primary, unset primary flag from other databases in the project
      await this.constructor.query()
        .where('project_id', this.project_id)
        .where('id', '!=', this.id)
        .where('is_primary', true)
        .patch({ is_primary: false });
    }
  }

  // Get connection configuration for the database
  getConnectionConfig() {
    const { connection_config, type } = this;
    
    // Create a copy of the config to avoid modifying the original
    const config = { ...connection_config };
    
    // Add type-specific configuration
    switch (type) {
      case 'postgresql':
        return {
          client: 'pg',
          connection: {
            host: config.host,
            port: config.port || 5432,
            database: config.database,
            user: config.username,
            password: config.password,
            ssl: config.ssl ? { rejectUnauthorized: false } : false,
          },
          pool: {
            min: 1,
            max: 5,
          },
        };
      
      case 'mysql':
        return {
          client: 'mysql2',
          connection: {
            host: config.host,
            port: config.port || 3306,
            database: config.database,
            user: config.username,
            password: config.password,
            ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
          },
        };
      
      case 'mongodb':
        return {
          client: 'mongodb',
          connection: {
            url: `mongodb://${config.username}:${encodeURIComponent(config.password)}@${config.host}:${config.port || 27017}/${config.database}?authSource=admin`,
            options: {
              useNewUrlParser: true,
              useUnifiedTopology: true,
              ssl: config.ssl || false,
            },
          },
        };
      
      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  }

  // Test the database connection
  async testConnection() {
    const knex = require('knex');
    const config = this.getConnectionConfig();
    
    try {
      const db = knex(config);
      // Test the connection with a simple query
      await db.raw('SELECT 1');
      await db.destroy();
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        details: error
      };
    }
  }

  // Get the primary database for a project
  static async getPrimaryDatabase(projectId) {
    return this.query()
      .where('project_id', projectId)
      .where('is_primary', true)
      .first();
  }

  // Get all active databases for a project
  static async getProjectDatabases(projectId) {
    return this.query()
      .where('project_id', projectId)
      .where('is_active', true)
      .whereNull('deleted_at');
  }
}
