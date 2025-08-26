import { BaseModel } from './BaseModel.js';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export class ProjectMember extends BaseModel {
  // Available roles and their permissions
  static ROLES = {
    ADMIN: {
      key: 'admin',
      name: 'Administrator',
      description: 'Full access to all project features and settings',
      permissions: [
        'project:read', 'project:update', 'project:delete', 'project:export', 'project:import',
        'member:list', 'member:add', 'member:remove', 'member:update',
        'query:create', 'query:read', 'query:update', 'query:delete', 'query:execute', 'query:export', 'query:import',
        'database:create', 'database:read', 'database:update', 'database:delete', 'database:test',
        'dashboard:create', 'dashboard:read', 'dashboard:update', 'dashboard:delete',
        'schedule:create', 'schedule:read', 'schedule:update', 'schedule:delete', 'schedule:execute',
        'api_key:create', 'api_key:read', 'api_key:update', 'api_key:delete',
        'webhook:create', 'webhook:read', 'webhook:update', 'webhook:delete',
        'settings:read', 'settings:update',
        'activity:read'
      ]
    },
    EDITOR: {
      key: 'editor',
      name: 'Editor',
      description: 'Can create and edit content but cannot manage project settings or members',
      permissions: [
        'project:read', 'project:export',
        'member:list',
        'query:create', 'query:read', 'query:update', 'query:delete', 'query:execute', 'query:export',
        'database:read', 'database:test',
        'dashboard:create', 'dashboard:read', 'dashboard:update', 'dashboard:delete',
        'schedule:create', 'schedule:read', 'schedule:update', 'schedule:delete', 'schedule:execute',
        'api_key:read',
        'webhook:read',
        'settings:read',
        'activity:read'
      ]
    },
    VIEWER: {
      key: 'viewer',
      name: 'Viewer',
      description: 'Can only view content and run queries',
      permissions: [
        'project:read',
        'member:list',
        'query:read', 'query:execute',
        'database:read',
        'dashboard:read',
        'schedule:read',
        'settings:read',
        'activity:read'
      ]
    },
    CUSTOM: {
      key: 'custom',
      name: 'Custom',
      description: 'Custom role with specific permissions',
      permissions: []
    }
  };

  static get tableName() {
    return 'project_members';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['project_id', 'user_id', 'role'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        project_id: { type: 'string', format: 'uuid' },
        user_id: { type: 'string', format: 'uuid' },
        role: { 
          type: 'string',
          enum: Object.values(this.ROLES).map(r => r.key)
        },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          default: []
        },
        is_active: { type: 'boolean', default: true },
        invited_by: { type: ['string', 'null'], format: 'uuid' },
        invited_at: { type: ['string', 'null'], format: 'date-time' },
        joined_at: { type: ['string', 'null'], format: 'date-time' },
        last_accessed_at: { type: ['string', 'null'], format: 'date-time' },
        metadata: {
          type: 'object',
          default: {}
        },
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
          from: 'project_members.project_id',
          to: 'projects.id',
        },
      },
      user: {
        relation: this.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_members.user_id',
          to: 'users.id',
        },
      },
      invitedBy: {
        relation: this.BelongsToOneRelation,
        modelClass: 'User.js',
        join: {
          from: 'project_members.invited_by',
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
    
    // Set default permissions based on role if not provided
    if (!this.permissions || this.permissions.length === 0) {
      this.permissions = this.getRolePermissions();
    }
  }

  $beforeUpdate() {
    super.$beforeUpdate();
    this.updated_at = new Date().toISOString();
  }

  /**
   * Get permissions for the member's role
   * @returns {Array} - List of permissions
   */
  getRolePermissions() {
    const role = Object.values(ProjectMember.ROLES).find(r => r.key === this.role);
    return role ? [...role.permissions] : [];
  }

  /**
   * Check if member has a specific permission
   * @param {string} permission - Permission to check
   * @returns {boolean} - True if member has the permission
   */
  hasPermission(permission) {
    // Admins have all permissions
    if (this.role === ProjectMember.ROLES.ADMIN.key) {
      return true;
    }
    
    // Check if the permission is in the member's permissions
    return this.permissions.includes(permission);
  }

  /**
   * Check if member has any of the specified permissions
   * @param {Array} permissions - List of permissions to check
   * @returns {boolean} - True if member has any of the permissions
   */
  hasAnyPermission(permissions) {
    if (!Array.isArray(permissions)) {
      return this.hasPermission(permissions);
    }
    
    // Admins have all permissions
    if (this.role === ProjectMember.ROLES.ADMIN.key) {
      return true;
    }
    
    return permissions.some(permission => this.permissions.includes(permission));
  }

  /**
   * Get member by project and user ID
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID
   * @returns {Promise<ProjectMember|null>} - Project member or null if not found
   */
  static async getByProjectAndUser(projectId, userId) {
    return this.query()
      .where('project_id', projectId)
      .where('user_id', userId)
      .first();
  }

  /**
   * Get all members for a project
   * @param {string} projectId - Project ID
   * @param {Object} options - Query options
   * @param {boolean} [options.includeInactive=false] - Include inactive members
   * @param {string} [options.role] - Filter by role
   * @param {number} [options.limit=100] - Maximum number of results
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Promise<Array>} - List of project members
   */
  static async getByProject(
    projectId,
    {
      includeInactive = false,
      role,
      limit = 100,
      offset = 0
    } = {}
  ) {
    let query = this.query()
      .where('project_id', projectId)
      .withGraphFetched('[user, invitedBy]')
      .orderBy('created_at', 'ASC')
      .limit(limit)
      .offset(offset);
    
    if (!includeInactive) {
      query = query.where('is_active', true);
    }
    
    if (role) {
      query = query.where('role', role);
    }
    
    return query;
  }

  /**
   * Get all projects for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @param {boolean} [options.includeInactive=false] - Include inactive memberships
   * @param {string} [options.role] - Filter by role
   * @param {number} [options.limit=100] - Maximum number of results
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Promise<Array>} - List of project memberships
   */
  static async getByUser(
    userId,
    {
      includeInactive = false,
      role,
      limit = 100,
      offset = 0
    } = {}
  ) {
    let query = this.query()
      .where('user_id', userId)
      .withGraphFetched('project')
      .orderBy('created_at', 'DESC')
      .limit(limit)
      .offset(offset);
    
    if (!includeInactive) {
      query = query.where('is_active', true);
    }
    
    if (role) {
      query = query.where('role', role);
    }
    
    return query;
  }

  /**
   * Add a member to a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID to add
   * @param {string} role - Member role
   * @param {string} invitedBy - ID of the user who is adding the member
   * @param {Array} [customPermissions] - Custom permissions (only for custom roles)
   * @returns {Promise<ProjectMember>} - The created project member
   */
  static async addMember(projectId, userId, role, invitedBy, customPermissions = []) {
    // Check if user is already a member
    const existingMember = await this.getByProjectAndUser(projectId, userId);
    if (existingMember) {
      if (existingMember.is_active) {
        throw new Error('User is already a member of this project');
      }
      
      // Reactivate existing membership
      return existingMember.$query().patchAndFetch({
        role,
        is_active: true,
        invited_by: invitedBy,
        invited_at: new Date().toISOString(),
        joined_at: null,
        last_accessed_at: null,
        permissions: role === ProjectMember.ROLES.CUSTOM.key ? customPermissions : undefined,
        updated_at: new Date().toISOString()
      });
    }
    
    // Create new membership
    return this.query().insert({
      id: uuidv4(),
      project_id: projectId,
      user_id: userId,
      role,
      permissions: role === ProjectMember.ROLES.CUSTOM.key ? customPermissions : undefined,
      is_active: true,
      invited_by: invitedBy,
      invited_at: new Date().toISOString(),
      joined_at: null,
      last_accessed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }

  /**
   * Remove a member from a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID to remove
   * @returns {Promise<number>} - Number of affected rows
   */
  static async removeMember(projectId, userId) {
    // Don't allow removing the last admin
    const admins = await this.query()
      .where('project_id', projectId)
      .where('role', ProjectMember.ROLES.ADMIN.key)
      .where('is_active', true);
    
    const member = await this.getByProjectAndUser(projectId, userId);
    
    if (member?.role === ProjectMember.ROLES.ADMIN.key && admins.length <= 1) {
      throw new Error('Cannot remove the last admin from a project');
    }
    
    // Soft delete the membership
    return this.query()
      .where('project_id', projectId)
      .where('user_id', userId)
      .patch({
        is_active: false,
        updated_at: new Date().toISOString()
      });
  }

  /**
   * Update member role and permissions
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID to update
   * @param {string} role - New role
   * @param {Array} [customPermissions] - Custom permissions (only for custom roles)
   * @returns {Promise<ProjectMember>} - Updated project member
   */
  static async updateMember(projectId, userId, role, customPermissions = []) {
    // Don't allow changing the last admin's role
    if (role !== ProjectMember.ROLES.ADMIN.key) {
      const admins = await this.query()
        .where('project_id', projectId)
        .where('role', ProjectMember.ROLES.ADMIN.key)
        .where('is_active', true);
      
      const member = await this.getByProjectAndUser(projectId, userId);
      
      if (member?.role === ProjectMember.ROLES.ADMIN.key && admins.length <= 1) {
        throw new Error('Cannot change the role of the last admin');
      }
    }
    
    // Update the membership
    return this.query()
      .where('project_id', projectId)
      .where('user_id', userId)
      .patchAndFetch({
        role,
        permissions: role === ProjectMember.ROLES.CUSTOM.key ? customPermissions : undefined,
        updated_at: new Date().toISOString()
      });
  }

  /**
   * Check if a user has a specific permission in a project
   * @param {string} projectId - Project ID
   * @param {string} userId - User ID
   * @param {string|Array} permission - Permission or array of permissions to check
   * @returns {Promise<boolean>} - True if user has the permission
   */
  static async hasPermission(projectId, userId, permission) {
    const member = await this.query()
      .where('project_id', projectId)
      .where('user_id', userId)
      .where('is_active', true)
      .first();
    
    if (!member) {
      return false;
    }
    
    // Convert single permission to array for consistent handling
    const permissions = Array.isArray(permission) ? permission : [permission];
    
    // Admins have all permissions
    if (member.role === ProjectMember.ROLES.ADMIN.key) {
      return true;
    }
    
    // Check if any of the required permissions are granted
    return permissions.some(p => member.permissions.includes(p));
  }

  /**
   * Get all available roles
   * @returns {Array} - List of available roles with their details
   */
  static getAvailableRoles() {
    return Object.values(this.ROLES).map(({ key, name, description, permissions }) => ({
      key,
      name,
      description,
      permissions
    }));
  }

  /**
   * Get all available permissions
   * @returns {Array} - List of all available permissions
   */
  static getAllPermissions() {
    const allPermissions = new Set();
    
    // Collect all unique permissions from all roles
    Object.values(this.ROLES).forEach(role => {
      role.permissions.forEach(permission => {
        allPermissions.add(permission);
      });
    });
    
    return Array.from(allPermissions).sort();
  }
}
