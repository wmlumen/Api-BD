import { BaseModel } from './BaseModel.js';
import { v4 as uuidv4 } from 'uuid';

export class ProjectActivity extends BaseModel {
  static get tableName() {
    return 'project_activities';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['project_id', 'user_id', 'action', 'entity_type'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        project_id: { type: 'string', format: 'uuid' },
        user_id: { type: 'string', format: 'uuid' },
        action: { 
          type: 'string', 
          enum: [
            'create', 'update', 'delete', 'restore', 'export', 'import',
            'execute', 'schedule', 'share', 'unshare', 'comment', 'approve',
            'reject', 'publish', 'unpublish', 'archive', 'restore', 'login', 'logout'
          ]
        },
        entity_type: { 
          type: 'string',
          enum: [
            'project', 'query', 'database', 'user', 'api_key', 'webhook',
            'template', 'dashboard', 'visualization', 'schedule', 'comment'
          ]
        },
        entity_id: { type: ['string', 'null'], format: 'uuid' },
        entity_name: { type: ['string', 'null'], maxLength: 255 },
        metadata: {
          type: 'object',
          default: {},
          additionalProperties: true
        },
        ip_address: { type: ['string', 'null'], maxLength: 45 },
        user_agent: { type: ['string', 'null'], maxLength: 500 },
        created_at: { type: 'string', format: 'date-time' },
      },
    };
  }

  static get relationMappings() {
    return {
      project: {
        relation: this.BelongsToOneRelation,
        modelClass: 'Project.js',
        join: {
          from: 'project_activities.project_id',
          to: 'projects.id',
        },
      },
      user: {
        relation: this.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_activities.user_id',
          to: 'users.id',
        },
      },
    };
  }

  $beforeInsert() {
    super.$beforeInsert();
    
    if (!this.id) {
      this.id = uuidv4();
    }
    
    if (!this.metadata) {
      this.metadata = {};
    }
    
    this.created_at = new Date().toISOString();
  }

  /**
   * Log a new activity
   * @param {Object} data - Activity data
   * @param {string} data.projectId - Project ID
   * @param {string} data.userId - User ID
   * @param {string} data.action - Action performed
   * @param {string} data.entityType - Type of entity affected
   * @param {string} [data.entityId] - ID of the affected entity
   * @param {string} [data.entityName] - Name of the affected entity
   * @param {Object} [metadata] - Additional metadata
   * @param {Object} [request] - Express request object for IP and user agent
   * @returns {Promise<ProjectActivity>} - The created activity
   */
  static async log({
    projectId,
    userId,
    action,
    entityType,
    entityId = null,
    entityName = null,
    metadata = {},
    request = null
  }) {
    const activityData = {
      project_id: projectId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      metadata,
    };

    // Add request info if available
    if (request) {
      activityData.ip_address = request.ip || request.connection?.remoteAddress;
      activityData.user_agent = request.get('user-agent');
    }

    return this.query().insert(activityData);
  }

  /**
   * Get activities for a project with filters
   * @param {string} projectId - Project ID
   * @param {Object} [filters] - Filter options
   * @param {string} [filters.action] - Filter by action
   * @param {string} [filters.entityType] - Filter by entity type
   * @param {string} [filters.userId] - Filter by user ID
   * @param {Date} [filters.startDate] - Filter by start date
   * @param {Date} [filters.endDate] - Filter by end date
   * @param {number} [limit=50] - Number of items to return
   * @param {number} [offset=0] - Offset for pagination
   * @returns {Promise<Array>} - List of activities
   */
  static async getProjectActivities(
    projectId,
    {
      action,
      entityType,
      userId,
      startDate,
      endDate,
    } = {},
    limit = 50,
    offset = 0
  ) {
    let query = this.query()
      .where('project_id', projectId)
      .withGraphFetched('[user, project]')
      .orderBy('created_at', 'DESC')
      .limit(limit)
      .offset(offset);

    if (action) {
      query = Array.isArray(action)
        ? query.whereIn('action', action)
        : query.where('action', action);
    }

    if (entityType) {
      query = Array.isArray(entityType)
        ? query.whereIn('entity_type', entityType)
        : query.where('entity_type', entityType);
    }

    if (userId) {
      query = query.where('user_id', userId);
    }

    if (startDate) {
      query = query.where('created_at', '>=', startDate.toISOString());
    }

    if (endDate) {
      query = query.where('created_at', '<=', endDate.toISOString());
    }

    return query;
  }

  /**
   * Get recent activities across all projects
   * @param {Object} [filters] - Filter options
   * @param {number} [limit=20] - Number of items to return
   * @returns {Promise<Array>} - List of recent activities
   */
  static async getRecentActivities(filters = {}, limit = 20) {
    let query = this.query()
      .withGraphFetched('[user, project]')
      .orderBy('created_at', 'DESC')
      .limit(limit);

    if (filters.userId) {
      query = query.where('user_id', filters.userId);
    }

    if (filters.entityType) {
      query = query.where('entity_type', filters.entityType);
    }

    if (filters.action) {
      query = query.where('action', filters.action);
    }

    if (filters.startDate) {
      query = query.where('created_at', '>=', filters.startDate.toISOString());
    }

    if (filters.endDate) {
      query = query.where('created_at', '<=', filters.endDate.toISOString());
    }

    return query;
  }

  /**
   * Get activity statistics for a project
   * @param {string} projectId - Project ID
   * @param {Date} [startDate] - Start date for statistics
   * @param {Date} [endDate] - End date for statistics
   * @returns {Promise<Object>} - Activity statistics
   */
  static async getActivityStats(projectId, startDate = null, endDate = null) {
    let query = this.query()
      .select([
        'action',
        'entity_type',
        this.raw('COUNT(*) as count'),
        this.raw('MAX(created_at) as last_occurred')
      ])
      .where('project_id', projectId)
      .groupBy('action', 'entity_type');

    if (startDate) {
      query = query.where('created_at', '>=', startDate.toISOString());
    }

    if (endDate) {
      query = query.where('created_at', '<=', endDate.toISOString());
    }

    const results = await query;

    // Format results into a more usable structure
    const stats = {
      byAction: {},
      byEntity: {},
      total: 0
    };

    results.forEach(row => {
      // Group by action
      if (!stats.byAction[row.action]) {
        stats.byAction[row.action] = 0;
      }
      stats.byAction[row.action] += parseInt(row.count);

      // Group by entity type
      if (!stats.byEntity[row.entity_type]) {
        stats.byEntity[row.entity_type] = 0;
      }
      stats.byEntity[row.entity_type] += parseInt(row.count);

      // Total count
      stats.total += parseInt(row.count);
    });

    return stats;
  }
}
