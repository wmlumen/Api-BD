import { Model } from 'objection';
import { knexInstance } from '../config/database.js';

// Initialize knex for Objection
Model.knex(knexInstance);

export class BaseModel extends Model {
  // Add common functionality for all models
  static get useLimitInFirst() {
    return true;
  }

  // Add multi-tenancy support
  static get useTenant() {
    return true;
  }

  // Default query modifiers for multi-tenancy
  static get modifiers() {
    return {
      // Apply tenant filter to all queries
      tenant(query, userId, projectId) {
        if (this.useTenant) {
          if (userId) {
            query.where('user_id', userId);
          }
          if (projectId) {
            query.where('project_id', projectId);
          }
        }
        return query;
      },
      
      // For soft delete
      notDeleted(builder) {
        builder.whereNull('deleted_at');
      },
      
      // For active records
      active(builder) {
        builder.where('is_active', true);
      },
    };
  }

  // Timestamps
  $beforeInsert() {
    this.created_at = new Date().toISOString();
    this.updated_at = new Date().toISOString();
  }

  $beforeUpdate() {
    this.updated_at = new Date().toISOString();
  }

  // Soft delete
  $beforeDelete() {
    this.deleted_at = new Date().toISOString();
    return this.$query().patch({ deleted_at: this.deleted_at });
  }

  // Helper method to check permissions
  static async checkPermission(userId, projectId, requiredRole) {
    // Default implementation - can be overridden by child classes
    if (!userId) return false;
    
    // Check if user has the required role for the project
    const userProject = await this.relatedQuery('user_projects')
      .findOne({
        user_id: userId,
        project_id: projectId,
      });

    if (!userProject) return false;
    
    // Role hierarchy: admin > editor > user
    const roleHierarchy = {
      user: 1,
      editor: 2,
      admin: 3
    };

    return roleHierarchy[userProject.role] >= roleHierarchy[requiredRole];
  }
}
