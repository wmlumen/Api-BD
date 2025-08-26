import { BaseModel } from './BaseModel.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export class ProjectVersion extends BaseModel {
  static get tableName() {
    return 'project_versions';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['project_id', 'version', 'created_by'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        project_id: { type: 'string', format: 'uuid' },
        version: { type: 'string', maxLength: 50 },
        name: { type: 'string', maxLength: 255 },
        description: { type: ['string', 'null'], maxLength: 1000 },
        is_current: { type: 'boolean', default: false },
        metadata: {
          type: 'object',
          default: {},
          properties: {
            changes: { type: 'array', items: { type: 'string' }, default: [] },
            query_count: { type: 'number', default: 0 },
            database_count: { type: 'number', default: 0 },
            dashboard_count: { type: 'number', default: 0 },
            size: { type: 'number', default: 0 }, // Size in bytes
            tags: { type: 'array', items: { type: 'string' }, default: [] },
          }
        },
        created_by: { type: 'string', format: 'uuid' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    };
  }

  static get relationMappings() {
    return {
      project: {
        relation: this.BelongsToOneRelation,
        modelClass: 'Project.js',
        join: {
          from: 'project_versions.project_id',
          to: 'projects.id',
        },
      },
      createdBy: {
        relation: this.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_versions.created_by',
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
    this.updated_at = this.created_at;
  }

  $beforeUpdate() {
    super.$beforeUpdate();
    this.updated_at = new Date().toISOString();
  }

  /**
   * Get the current version for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<ProjectVersion|null>} - Current version or null if not found
   */
  static async getCurrentVersion(projectId) {
    return this.query()
      .where('project_id', projectId)
      .where('is_current', true)
      .first();
  }

  /**
   * Get all versions for a project
   * @param {string} projectId - Project ID
   * @param {Object} options - Query options
   * @param {number} [options.limit=50] - Number of items to return
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.sortBy='created_at'] - Field to sort by
   * @param {string} [options.sortOrder='DESC'] - Sort order (ASC or DESC)
   * @returns {Promise<Array>} - List of versions
   */
  static async getByProject(
    projectId,
    { limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'DESC' } = {}
  ) {
    return this.query()
      .where('project_id', projectId)
      .orderBy(sortBy, sortOrder)
      .limit(limit)
      .offset(offset);
  }

  /**
   * Create a new version for a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID creating the version
   * @param {Object} data - Version data
   * @param {string} data.name - Version name
   * @param {string} [data.description] - Version description
   * @param {string} [data.version] - Version number (auto-generated if not provided)
   * @param {Object} [metadata] - Additional metadata
   * @returns {Promise<ProjectVersion>} - The created version
   */
  static async createVersion(projectId, userId, { name, description = '', version = null, metadata = {} }) {
    const trx = await this.startTransaction();
    
    try {
      // Get the current version to determine the next version number
      const currentVersion = await this.getCurrentVersion(projectId);
      
      // Generate version number if not provided
      if (!version) {
        version = currentVersion 
          ? this.incrementVersion(currentVersion.version) 
          : '1.0.0';
      }
      
      // Mark current version as not current
      if (currentVersion) {
        await currentVersion.$query(trx).patch({ is_current: false });
      }
      
      // Create new version
      const newVersion = await this.query(trx).insert({
        id: uuidv4(),
        project_id: projectId,
        version,
        name,
        description,
        is_current: true,
        metadata: {
          ...metadata,
          created_from_version: currentVersion?.id || null,
        },
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      await trx.commit();
      return newVersion;
    } catch (error) {
      await trx.rollback();
      logger.error('Error creating project version:', error);
      throw error;
    }
  }

  /**
   * Increment a semantic version number
   * @param {string} version - Current version (e.g., '1.0.0')
   * @param {string} [level='patch'] - Level to increment: 'major', 'minor', or 'patch'
   * @returns {string} - New version number
   */
  static incrementVersion(version, level = 'patch') {
    if (!version) return '1.0.0';
    
    try {
      const parts = version.split('.').map(Number);
      
      // Ensure we have at least major.minor.patch
      while (parts.length < 3) {
        parts.push(0);
      }
      
      // Increment the appropriate part
      switch (level.toLowerCase()) {
        case 'major':
          parts[0] += 1;
          parts[1] = 0;
          parts[2] = 0;
          break;
        case 'minor':
          parts[1] += 1;
          parts[2] = 0;
          break;
        case 'patch':
        default:
          parts[2] += 1;
      }
      
      return parts.join('.');
    } catch (error) {
      logger.error('Error incrementing version:', error);
      // Fallback to timestamp if version format is invalid
      return `1.0.${Date.now()}`;
    }
  }

  /**
   * Restore a previous version of the project
   * This creates a new version with the restored data
   * @param {string} versionId - Version ID to restore
   * @param {string} userId - User ID performing the restore
   * @param {string} [restoreName] - Name for the restored version
   * @param {string} [restoreDescription] - Description for the restored version
   * @returns {Promise<Object>} - Restore result
   */
  static async restoreVersion(versionId, userId, restoreName, restoreDescription) {
    const trx = await this.startTransaction();
    
    try {
      // Get the version to restore
      const versionToRestore = await this.query(trx).findById(versionId);
      if (!versionToRestore) {
        throw new Error('Version not found');
      }
      
      // Get the project
      const { default: Project } = await import('./Project.js');
      const project = await Project.query(trx).findById(versionToRestore.project_id);
      if (!project) {
        throw new Error('Project not found');
      }
      
      // Create a backup of the current state
      const currentVersion = await this.getCurrentVersion(project.id);
      const backupName = restoreName || `Backup before restoring ${versionToRestore.name || versionToRestore.version}`;
      const backupDescription = restoreDescription || `Backup created before restoring to version ${versionToRestore.version}`;
      
      // Create a new version with the current state as a backup
      const backupVersion = await this.query(trx).insert({
        id: uuidv4(),
        project_id: project.id,
        version: this.incrementVersion(currentVersion?.version, 'patch'),
        name: backupName,
        description: backupDescription,
        is_current: false,
        metadata: {
          ...(currentVersion?.metadata || {}),
          is_backup: true,
          restored_from: versionId,
        },
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      // TODO: Restore the actual project data from the version
      // This would involve restoring queries, databases, dashboards, etc.
      // The implementation would depend on how you're storing versioned data
      
      // Create a new version with the restored data
      const restoredVersion = await this.query(trx).insert({
        id: uuidv4(),
        project_id: project.id,
        version: this.incrementVersion(versionToRestore.version, 'patch'),
        name: restoreName || `Restored: ${versionToRestore.name || versionToRestore.version}`,
        description: restoreDescription || `Restored from version ${versionToRestore.version}`,
        is_current: true,
        metadata: {
          ...(versionToRestore.metadata || {}),
          restored_from: versionId,
          restored_at: new Date().toISOString(),
          restored_by: userId,
          backup_version_id: backupVersion.id,
        },
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      // Mark the current version as not current
      if (currentVersion) {
        await currentVersion.$query(trx).patch({ is_current: false });
      }
      
      // Update the project's updated_at timestamp
      await project.$query(trx).patch({ updated_at: new Date().toISOString() });
      
      await trx.commit();
      
      return {
        success: true,
        restoredVersion,
        backupVersion,
      };
    } catch (error) {
      await trx.rollback();
      logger.error('Error restoring version:', error);
      throw error;
    }
  }

  /**
   * Compare two versions of a project
   * @param {string} versionId1 - First version ID
   * @param {string} versionId2 - Second version ID (defaults to current version if not provided)
   * @returns {Promise<Object>} - Comparison result
   */
  static async compareVersions(versionId1, versionId2 = null) {
    const version1 = await this.query().findById(versionId1);
    if (!version1) {
      throw new Error('First version not found');
    }
    
    let version2;
    if (versionId2) {
      version2 = await this.query().findById(versionId2);
      if (!version2) {
        throw new Error('Second version not found');
      }
    } else {
      // Get current version if second version not provided
      version2 = await this.getCurrentVersion(version1.project_id);
      if (!version2) {
        throw new Error('Current version not found');
      }
    }
    
    // TODO: Implement actual comparison of version data
    // This would involve comparing the state of queries, databases, etc. between versions
    
    return {
      version1: {
        id: version1.id,
        version: version1.version,
        name: version1.name,
        created_at: version1.created_at,
        created_by: version1.created_by,
      },
      version2: version2 ? {
        id: version2.id,
        version: version2.version,
        name: version2.name,
        created_at: version2.created_at,
        created_by: version2.created_by,
      } : null,
      changes: [], // This would contain the actual differences
    };
  }

  /**
   * Get version statistics for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} - Version statistics
   */
  static async getVersionStats(projectId) {
    const [totalVersions, versionsByUser, versionsByMonth] = await Promise.all([
      // Total number of versions
      this.query()
        .where('project_id', projectId)
        .resultSize(),
      
      // Versions by user
      this.query()
        .select('users.id', 'users.name', 'users.email')
        .count('project_versions.id as version_count')
        .joinRelated('createdBy')
        .where('project_versions.project_id', projectId)
        .groupBy('users.id', 'users.name', 'users.email')
        .orderBy('version_count', 'DESC'),
      
      // Versions by month
      this.knex()
        .select(
          this.knex.raw("to_char(created_at, 'YYYY-MM') as month"),
          this.knex.raw('count(*) as version_count')
        )
        .from('project_versions')
        .where('project_id', projectId)
        .groupBy('month')
        .orderBy('month', 'ASC')
    ]);
    
    return {
      total_versions: totalVersions,
      versions_by_user: versionsByUser,
      versions_by_month: versionsByMonth,
    };
  }
}
