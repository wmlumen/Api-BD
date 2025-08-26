import jwt from 'jsonwebtoken';
import { User, Project } from '../models/index.js';

/**
 * Middleware to authenticate JWT token
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'No token provided or invalid token format' 
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'No token provided' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists
    const user = await User.query().findById(decoded.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not found or account is inactive' 
      });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
};

/**
 * Middleware to check if user has required role for a project
 * @param {string} requiredRole - Required role ('user', 'editor', 'admin')
 */
export const authorizeProject = (requiredRole = 'user') => {
  return async (req, res, next) => {
    try {
      const { projectId } = req.params;
      const userId = req.user.id;

      if (!projectId) {
        return res.status(400).json({ 
          success: false, 
          error: 'Project ID is required' 
        });
      }

      // Get user's role in the project
      const userProject = await Project.relatedQuery('members')
        .for(projectId)
        .where('user_id', userId)
        .first();

      // Check if user has access to the project
      if (!userProject) {
        return res.status(403).json({ 
          success: false, 
          error: 'You do not have access to this project' 
        });
      }

      // Check role hierarchy
      const roleHierarchy = {
        user: 1,
        editor: 2,
        admin: 3
      };

      if (roleHierarchy[userProject.role] < roleHierarchy[requiredRole]) {
        return res.status(403).json({ 
          success: false, 
          error: `Insufficient permissions. Required role: ${requiredRole}` 
        });
      }

      // Attach project role to request
      req.projectRole = userProject.role;
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Error authorizing request' 
      });
    }
  };
};

/**
 * Middleware to check API key authentication
 */
export const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ 
        success: false, 
        error: 'API key is required' 
      });
    }

    // In a real implementation, you would validate the API key against your database
    // and check permissions
    const { Project, ApiKey } = require('../models');
    const key = await ApiKey.query()
      .where('key_hash', await bcrypt.hash(apiKey, 10))
      .where('is_active', true)
      .where('expires_at', '>', new Date())
      .first();

    if (!key) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or expired API key' 
      });
    }

    // Attach API key info to request
    req.apiKey = key;
    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Error authenticating API key' 
    });
  }
};

/**
 * Middleware to handle project context
 */
export const projectContext = async (req, res, next) => {
  try {
    const projectId = req.headers['x-project-id'] || req.query.projectId;
    
    if (!projectId) {
      return next();
    }

    // Verify project exists and user has access
    const project = await Project.query()
      .findById(projectId)
      .withGraphFetched('members')
      .modifyGraph('members', builder => {
        builder.where('user_id', req.user.id);
      });

    if (!project) {
      return res.status(404).json({ 
        success: false, 
        error: 'Project not found or access denied' 
      });
    }

    // Attach project to request
    req.project = project;
    next();
  } catch (error) {
    console.error('Project context error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Error processing project context' 
    });
  }
};
