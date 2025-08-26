import { BaseModel } from './BaseModel.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { QueryBuilder } from 'objection';

// Soft delete plugin
import softDeleteFactory from 'objection-soft-delete';
const softDelete = softDeleteFactory({
  columnName: 'deleted_at',
  deletedValue: new Date(),
  notDeletedValue: null,
});

class Project extends softDelete(BaseModel) {
  static get tableName() {
    return 'projects';
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
        slug: { type: 'string', maxLength: 255 },
        logo_url: { type: ['string', 'null'], maxLength: 500 },
        is_public: { type: 'boolean', default: false },
        is_active: { type: 'boolean', default: true },
        is_template: { type: 'boolean', default: false },
        template_id: { type: ['string', 'null'], format: 'uuid' },
        version: { type: 'string', default: '1.0.0' },
        settings: {
          type: 'object',
          default: {},
          properties: {
            theme: { type: 'string', default: 'light' },
            language: { type: 'string', default: 'es' },
            timezone: { type: 'string', default: 'America/Santiago' },
            export_settings: {
              type: 'object',
              default: {
                include_queries: true,
                include_data: false,
                include_members: false,
                include_settings: true
              }
            },
            webhooks: {
              type: 'array',
              default: [],
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  events: { type: 'array', items: { type: 'string' } },
                  is_active: { type: 'boolean' },
                  secret: { type: 'string' },
                  created_at: { type: 'string' }
                }
              }
            }
          },
        },
        metadata: {
          type: 'object',
          default: {},
          properties: {
            last_exported_at: { type: ['string', 'null'], format: 'date-time' },
            last_imported_at: { type: ['string', 'null'], format: 'date-time' },
            export_count: { type: 'integer', default: 0 },
            import_count: { type: 'integer', default: 0 },
            tags: { type: 'array', items: { type: 'string' }, default: [] },
            custom_fields: { type: 'object' }
          }
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
      createdBy: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'projects.created_by',
          to: 'users.id',
        },
      },
      members: {
        relation: BaseModel.HasManyRelation,
        modelClass: 'ProjectMember.js',
        join: {
          from: 'projects.id',
          to: 'project_members.project_id',
        },
      },
      activities: {
        relation: BaseModel.HasManyRelation,
        modelClass: 'ProjectActivity.js',
        join: {
          from: 'projects.id',
          to: 'project_activities.project_id',
        },
      },
      versions: {
        relation: BaseModel.HasManyRelation,
        modelClass: 'ProjectVersion.js',
        join: {
          from: 'projects.id',
          to: 'project_versions.project_id',
        },
      },
      template: {
        relation: BaseModel.BelongsToOneRelation,
        modelClass: 'ProjectTemplate.js',
        join: {
          from: 'projects.template_id',
          to: 'project_templates.id',
        },
      },
      databases: {
        relation: BaseModel.HasManyRelation,
        modelClass: 'ProjectDatabase.js',
        join: {
          from: 'projects.id',
          to: 'project_databases.project_id',
        },
      },
      queries: {
        relation: BaseModel.HasManyRelation,
        modelClass: 'Query.js',
        join: {
          from: 'projects.id',
          to: 'queries.project_id',
        },
      },
    };
  }

  // Generate a URL-friendly slug from the project name
  $beforeInsert() {
    super.$beforeInsert();
    if (this.name && !this.slug) {
      this.slug = this.generateSlug(this.name);
    }
    
    // Set default values
    if (!this.settings) {
      this.settings = {};
    }
    
    if (!this.metadata) {
      this.metadata = {};
    }
    
    // If this is a template, set template flag
    if (this.is_template) {
      this.is_public = false; // Templates are never public
    }
  }

  $beforeUpdate() {
    super.$beforeUpdate();
    if (this.name && this.name !== this.$beforeUpdateName) {
      this.slug = this.generateSlug(this.name);
    }
  }

  /**
   * Create a new project from a template
   * @param {string} templateId - ID of the template to use
   * @param {string} userId - ID of the user creating the project
   * @param {Object} options - Project options
   * @param {string} options.name - Name for the new project
   * @param {string} options.description - Description for the new project
   * @param {Object} options.settings - Additional settings to override template settings
   * @param {Object} options.variables - Template variables to replace
   * @returns {Promise<Project>} - The created project
   */
  static async createFromTemplate(templateId, userId, { name, description, settings = {}, variables = {} } = {}) {
    const template = await ProjectTemplate.query().findById(templateId);
    
    if (!template) {
      throw new Error('Template not found');
    }

    // Create the project
    const project = await this.query().insert({
      id: uuidv4(),
      name: name || `${template.name} (Copy)`,
      description: description || template.description,
      template_id: templateId,
      is_template: false,
      is_public: false,
      is_active: true,
      settings: {
        ...template.settings,
        ...settings,
      },
      metadata: {
        ...template.metadata,
        created_from_template: true,
        template_id: templateId,
        template_version: template.version,
        template_variables: variables,
      },
      created_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Add creator as admin
    await project.addMember(userId, 'admin', userId);
    
    return project;
  }

  /**
   * Check if a user has a specific role in this project
   * @param {string} userId - The ID of the user
   * @param {string} requiredRole - The required role (user, editor, admin)
   * @returns {Promise<boolean>} - Whether the user has the required role
   */
  async userHasRole(userId, requiredRole) {
    const userProject = await this.$relatedQuery('members')
      .where('user_id', userId)
      .first();

    if (!userProject) return false;

    const roleHierarchy = {
      user: 1,
      editor: 2,
      admin: 3,
    };

    return roleHierarchy[userProject.role] >= roleHierarchy[requiredRole];
  }

  // Get all projects where user is a member with their role
  static async getUserProjects(userId, { limit = 10, offset = 0 } = {}) {
    return this.query()
      .select('projects.*', 'user_projects.role')
      .join('user_projects', 'projects.id', 'user_projects.project_id')
      .where('user_projects.user_id', userId)
      .where('projects.is_active', true)
      .whereNull('projects.deleted_at')
      .limit(limit)
      .offset(offset);
  }

  // Add a member to the project with a specific role
  async addMember(userId, role = 'user', addedBy) {
    const validRoles = ['user', 'editor', 'admin'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    // Check if user is already a member
    const existingMember = await this.$relatedQuery('members')
      .where('user_id', userId)
      .first();

    if (existingMember) {
      // Update existing role
      await this.$relatedQuery('members')
        .patch({ role })
        .where('user_id', userId);
    } else {
      // Add new member
      await this.$relatedQuery('members').insert({
        user_id: userId,
        role,
        added_by: addedBy || this.created_by,
      });
    }

    return this.$relatedQuery('members')
      .where('user_id', userId)
      .first();
  }

  // Remove a member from the project
  async removeMember(userId) {
    // Don't allow removing the last admin
    const adminCount = await this.$relatedQuery('members')
      .where('role', 'admin')
      .resultSize();

    if (adminCount <= 1) {
      const userRole = await this.$relatedQuery('members')
        .where('user_id', userId)
        .first();
      
      if (userRole?.role === 'admin') {
        throw new Error('No se puede eliminar al último administrador del proyecto');
      }
    }

    return this.$relatedQuery('members')
      .delete()
      .where('user_id', userId);
  }

  /**
   * Create a new version of the project
   * @param {string} userId - ID of the user creating the version
   * @param {string} name - Name for the version
   * @param {string} description - Description of changes
   * @returns {Promise<Object>} - The created version
   */
  async createVersion(userId, name, description = '') {
    const versionData = {
      id: uuidv4(),
      project_id: this.id,
      name,
      description,
      created_by: userId,
      data: await this.exportProject({ includeData: true })
    };

    return this.$relatedQuery('versions').insert(versionData);
  }

  /**
   * Export project data
   * @param {Object} options - Export options
   * @param {boolean} [options.includeData=false] - Whether to include query result data
   * @returns {Promise<Object>} - Exported project data
   */
  async exportProject(options = {}) {
    const { includeData = false } = options;
    
    // Get project data
    const projectData = this.toJSON();
    
    // Get project members
    const members = await ProjectMember.query()
      .where('project_id', this.id)
      .where('is_active', true);
    
    // Get project versions
    const versions = await ProjectVersion.query()
      .where('project_id', this.id)
      .orderBy('created_at', 'DESC');
    
    // Get project activities
    const activities = await ProjectActivity.query()
      .where('project_id', this.id)
      .orderBy('created_at', 'DESC')
      .limit(100); // Limit to most recent 100 activities
    
    // TODO: Add other related data (queries, databases, etc.)
    
    const exportData = {
      project: {
        ...projectData,
        // Remove sensitive or unnecessary fields
        settings: undefined,
        metadata: {
          ...projectData.metadata,
          export_date: new Date().toISOString(),
          export_version: '1.0.0',
        },
      },
      members: members.map(m => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
      })),
      versions: versions.map(v => ({
        version: v.version,
        name: v.name,
        description: v.description,
        created_at: v.created_at,
        created_by: v.created_by,
        metadata: v.metadata,
      })),
      activities: activities.map(a => ({
        action: a.action,
        entity_type: a.entity_type,
        entity_id: a.entity_id,
        created_at: a.created_at,
        created_by: a.user_id,
        metadata: a.metadata,
      })),
    };
    
    // Log the export activity
    await this.logActivity(
      this.created_by, // Use project owner or system user
      'export',
      'project',
      this.id,
      { include_data: includeData }
    );
    
    // Update export metadata
    await this.$query().patch({
      metadata: {
        ...this.metadata,
        last_exported_at: new Date().toISOString(),
        export_count: (this.metadata?.export_count || 0) + 1,
      },
      updated_at: new Date().toISOString(),
    });
    
    return exportData;
  }

  /**
   * Import data into the project
   * @param {Object} importData - Data to import
   * @param {string} userId - User ID performing the import
   * @returns {Promise<Object>} - Import result
   */
  async importData(importData, userId) {
    const trx = await this.$transaction();
    
    try {
      const { project, members = [], versions = [], activities = [] } = importData;
      
      // Update project metadata
      await this.$query(trx).patch({
        metadata: {
          ...this.metadata,
          ...(project.metadata || {}),
          last_imported_at: new Date().toISOString(),
          import_count: (this.metadata?.import_count || 0) + 1,
          import_metadata: {
            imported_at: new Date().toISOString(),
            imported_by: userId,
            source_project_id: project.id,
            source_project_name: project.name,
          },
        },
        updated_at: new Date().toISOString(),
      });
      
      // Import members if any
      if (members.length > 0) {
        // Filter out existing members
        const existingMembers = await ProjectMember.query(trx)
          .where('project_id', this.id)
          .whereIn('user_id', members.map(m => m.user_id));
        
        const existingUserIds = new Set(existingMembers.map(m => m.user_id));
        const newMembers = members.filter(m => !existingUserIds.has(m.user_id));
        
        // Add new members
        await Promise.all(
          newMembers.map(member => 
            this.addMember(member.user_id, member.role, userId)
          )
        );
      }
      
      // Import versions if any
      if (versions.length > 0) {
        // Get existing versions to avoid duplicates
        const existingVersions = await ProjectVersion.query(trx)
          .where('project_id', this.id)
          .whereIn('version', versions.map(v => v.version));
        
        const existingVersionNumbers = new Set(existingVersions.map(v => v.version));
        const newVersions = versions.filter(v => !existingVersionNumbers.has(v.version));
        
        // Add new versions
        await ProjectVersion.query(trx).insert(
          newVersions.map(v => ({
            ...v,
            id: uuidv4(),
            project_id: this.id,
            is_current: false, // Don't make imported versions current by default
            created_at: v.created_at || new Date().toISOString(),
            updated_at: v.updated_at || new Date().toISOString(),
          }))
        );
      }
      
      // Import activities if any
      if (activities.length > 0) {
        // Limit to most recent 100 activities to prevent excessive imports
        const recentActivities = activities
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 100);
        
        await ProjectActivity.query(trx).insert(
          recentActivities.map(a => ({
            ...a,
            id: uuidv4(),
            project_id: this.id,
            created_at: a.created_at || new Date().toISOString(),
          }))
        );
      }
      
      // Log the import activity
      await this.logActivity(userId, 'import', 'project', this.id, {
        imported_items: {
          members: members.length,
          versions: versions.length,
          activities: activities.length,
        },
        source_project_id: project.id,
        source_project_name: project.name,
      });
      
      await trx.commit();
      
      return {
        success: true,
        imported: {
          members: members.length,
          versions: versions.length,
          activities: Math.min(activities.length, 100), // Limited to 100
        },
      };
    } catch (error) {
      await trx.rollback();
      logger.error('Error importing project data:', error);
      throw error;
    }
  }

  /**
   * Get project activity feed
   * @param {Object} options - Query options
   * @param {number} options.limit - Number of items to return
   * @param {number} options.offset - Offset for pagination
   * @returns {Promise<Array>} - List of activities
   */
  async getActivityFeed({ limit = 20, offset = 0 } = {}) {
    return this.$relatedQuery('activities')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .withGraphFetched('user');
  }

  /**
   * Log an activity for this project
   * @param {string} userId - ID of the user performing the action
   * @param {string} action - Action performed (e.g., 'create', 'update', 'delete')
   * @param {string} entityType - Type of entity affected (e.g., 'query', 'database')
   * @param {string} entityId - ID of the affected entity
   * @param {Object} metadata - Additional metadata about the activity
   * @returns {Promise<Object>} - The created activity
   */
  async logActivity(userId, action, entityType, entityId = null, metadata = {}) {
    const { default: ProjectActivity } = await import('./ProjectActivity.js');
    return ProjectActivity.query().insert({
      id: uuidv4(),
      project_id: this.id,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
      created_at: new Date().toISOString()
    });
  }
}

export default Project;
