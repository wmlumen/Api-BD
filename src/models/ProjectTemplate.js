import { BaseModel } from './BaseModel.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export class ProjectTemplate extends BaseModel {
  static get tableName() {
    return 'project_templates';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['name', 'created_by'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 255 },
        description: { type: ['string', 'null'], maxLength: 1000 },
        category: { type: 'string', maxLength: 100 },
        thumbnail_url: { type: ['string', 'null'], maxLength: 500 },
        is_public: { type: 'boolean', default: false },
        is_featured: { type: 'boolean', default: false },
        version: { type: 'string', default: '1.0.0' },
        metadata: {
          type: 'object',
          default: {},
          properties: {
            tags: { type: 'array', items: { type: 'string' }, default: [] },
            screenshots: { 
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  caption: { type: 'string' }
                }
              },
              default: []
            },
            requirements: { type: 'array', items: { type: 'string' }, default: [] },
            variables: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['string', 'number', 'boolean', 'select'] },
                  label: { type: 'string' },
                  description: { type: 'string' },
                  required: { type: 'boolean', default: true },
                  default: { type: ['string', 'number', 'boolean', 'null'] },
                  options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string' },
                        value: { type: ['string', 'number'] }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        settings: {
          type: 'object',
          default: {},
          properties: {
            theme: { type: 'string', default: 'light' },
            language: { type: 'string', default: 'es' },
            timezone: { type: 'string', default: 'America/Santiago' },
            features: {
              type: 'object',
              default: {}
            }
          }
        },
        created_by: { type: 'string', format: 'uuid' },
        updated_by: { type: ['string', 'null'], format: 'uuid' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        deleted_at: { type: ['string', 'null'], format: 'date-time' },
      },
    };
  }

  static get relationMappings() {
    return {
      createdBy: {
        relation: this.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_templates.created_by',
          to: 'users.id',
        },
      },
      updatedBy: {
        relation: this.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_templates.updated_by',
          to: 'users.id',
        },
      },
      projects: {
        relation: this.HasManyRelation,
        modelClass: 'Project.js',
        join: {
          from: 'project_templates.id',
          to: 'projects.template_id',
        },
      },
    };
  }

  $beforeInsert() {
    super.$beforeInsert();
    
    // Set default values
    if (!this.metadata) {
      this.metadata = {};
    }
    
    if (!this.settings) {
      this.settings = {};
    }
  }

  $beforeUpdate() {
    super.$beforeUpdate();
    this.updated_at = new Date().toISOString();
  }

  /**
   * Create a new project from this template
   * @param {string} userId - ID of the user creating the project
   * @param {Object} options - Project creation options
   * @param {string} options.name - Name for the new project
   * @param {string} options.description - Description for the new project
   * @param {Object} options.variables - Template variables
   * @param {Object} options.settings - Project settings
   * @returns {Promise<Object>} - The created project
   */
  async createProject(userId, options = {}) {
    const { name, description, variables = {}, settings = {} } = options;
    
    // Get the project data with template placeholders replaced
    const projectData = await this.getProjectData(variables);
    
    // Create the project
    const { default: Project } = await import('./Project.js');
    const project = await Project.query().insert({
      id: uuidv4(),
      name: name || this.name,
      description: description || this.description,
      template_id: this.id,
      created_by: userId,
      settings: { ...this.settings, ...settings },
      metadata: {
        ...this.metadata,
        created_from_template: true,
        template_version: this.version,
        template_variables: variables
      }
    });

    // Add creator as admin
    await project.addMember(userId, 'admin', userId);

    // Import the template data into the project
    await project.importData(projectData, userId);

    return project;
  }

  /**
   * Get project data with template placeholders replaced
   * @param {Object} variables - Template variables
   * @returns {Promise<Object>} - Project data with placeholders replaced
   */
  async getProjectData(variables = {}) {
    // In a real implementation, this would fetch the template data
    // and replace placeholders with the provided variables
    // For now, return a basic structure
    return {
      project: {
        name: this.name,
        description: this.description,
        settings: this.settings,
        metadata: {
          ...this.metadata,
          created_from_template: true,
          template_id: this.id,
          template_version: this.version
        }
      },
      databases: [],
      queries: []
    };
  }

  /**
   * Get all projects created from this template
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of items to return
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array>} - List of projects
   */
  async getProjects({ limit = 20, offset = 0 } = {}) {
    return this.$relatedQuery('projects')
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
  }

  /**
   * Get usage statistics for this template
   * @returns {Promise<Object>} - Usage statistics
   */
  async getUsageStats() {
    const [totalProjects, activeProjects] = await Promise.all([
      this.$relatedQuery('projects').resultSize(),
      this.$relatedQuery('projects')
        .where('is_active', true)
        .resultSize()
    ]);

    const lastUsed = await this.$relatedQuery('projects')
      .max('created_at as last_used')
      .first();

    return {
      total_projects: totalProjects,
      active_projects: activeProjects,
      last_used: lastUsed?.last_used || null
    };
  }

  /**
   * Create a new version of this template
   * @param {string} userId - ID of the user creating the version
   * @param {Object} updates - Updates to apply to the template
   * @returns {Promise<ProjectTemplate>} - The new template version
   */
  async createNewVersion(userId, updates = {}) {
    const { version, ...rest } = updates;
    
    // Create a copy of the current template
    const newTemplate = await ProjectTemplate.query().insert({
      ...this.toJSON(),
      id: uuidv4(),
      name: updates.name || this.name,
      description: updates.description || this.description,
      version: version || this.incrementVersion(this.version),
      previous_version_id: this.id,
      created_by: userId,
      updated_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      ...rest
    });

    // Archive the old version
    await this.$query().patch({
      is_public: false,
      updated_by: userId,
      updated_at: new Date().toISOString()
    });

    return newTemplate;
  }

  /**
   * Increment version number
   * @param {string} version - Current version string (semver)
   * @returns {string} - Incremented version string
   */
  incrementVersion(version) {
    const parts = version.split('.').map(Number);
    parts[parts.length - 1] += 1; // Increment patch version
    return parts.join('.');
  }
}
