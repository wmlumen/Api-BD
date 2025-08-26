import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { BaseModel } from './BaseModel.js';
import { logger } from '../utils/logger.js';

export class User extends BaseModel {
  static get tableName() {
    return 'users';
  }

  static get idColumn() {
    return 'id';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['email', 'password_hash'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email', maxLength: 255 },
        phone: { type: ['string', 'null'], maxLength: 20 },
        document_id: { type: ['string', 'null'], maxLength: 50 },
        password_hash: { type: 'string', minLength: 60, maxLength: 60 },
        first_name: { type: ['string', 'null'], maxLength: 100 },
        last_name: { type: ['string', 'null'], maxLength: 100 },
        is_active: { type: 'boolean', default: true },
        last_login: { type: ['string', 'null'], format: 'date-time' },
        email_verified: { type: 'boolean', default: false },
        phone_verified: { type: 'boolean', default: false },
        verification_token: { type: ['string', 'null'], maxLength: 255 },
        verification_token_expires: { type: ['string', 'null'], format: 'date-time' },
        reset_password_token: { type: ['string', 'null'], maxLength: 255 },
        reset_password_expires: { type: ['string', 'null'], format: 'date-time' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        deleted_at: { type: ['string', 'null'], format: 'date-time' },
      },
    };
  }

  static get relationMappings() {
    return {
      projects: {
        relation: BaseModel.ManyToManyRelation,
        modelClass: 'Project.js',
        join: {
          from: 'users.id',
          through: {
            from: 'user_projects.user_id',
            to: 'user_projects.project_id',
            extra: ['role', 'created_at']
          },
          to: 'projects.id'
        }
      }
    };
  }

  // Password hashing
  async $beforeInsert() {
    await super.$beforeInsert();
    if (this.password) {
      this.password_hash = await this.generateHash(this.password);
      delete this.password;
    }
  }

  async $beforeUpdate() {
    await super.$beforeUpdate();
    if (this.password) {
      this.password_hash = await this.generateHash(this.password);
      delete this.password;
    }
  }

  // Generate password hash
  async generateHash(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  // Verify password
  async verifyPassword(password) {
    return bcrypt.compare(password, this.password_hash);
  }

  // Generate JWT token
  generateAuthToken() {
    const payload = {
      id: this.id,
      email: this.email,
      role: 'user', // Default role, can be overridden in project context
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '1h',
    });
  }
  
  // Generate refresh token
  generateRefreshToken() {
    return jwt.sign(
      { id: this.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
    );
  }

  // Find user by credentials (email/phone/document + password)
  static async findByCredentials(identifier, password) {
    const user = await this.query()
      .findOne(builder => {
        builder.where('email', identifier)
          .orWhere('phone', identifier)
          .orWhere('document_id', identifier);
      })
      .first();

    if (!user) {
      throw new Error('Invalid login credentials');
    }

    const isPasswordMatch = await user.verifyPassword(password);
    if (!isPasswordMatch) {
      throw new Error('Invalid login credentials');
    }

    if (!user.is_active) {
      throw new Error('Account is inactive');
    }

    // Update last login
    await user.$query().patch({ last_login: new Date().toISOString() });

    return user;
  }

  // Get user with project role
  static async getUserWithProjectRole(userId, projectId) {
    return this.relatedQuery('projects')
      .for(userId)
      .where('project_id', projectId)
      .first();
  }
  
  // Create password reset token
  static async createPasswordResetToken(email) {
    const user = await this.query().findOne({ email });
    if (!user) return null;
    
    // Generate reset token (1 hour expiry)
    const resetToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET + user.password_hash,
      { expiresIn: '1h' }
    );
    
    // Save reset token to user
    await this.query()
      .findById(user.id)
      .patch({
        reset_password_token: resetToken,
        reset_password_expires: new Date(Date.now() + 3600000) // 1 hour
      });
    
    return { user, resetToken };
  }
  
  // Verify password reset token
  static async verifyPasswordResetToken(token) {
    // Find user by token
    const user = await this.query()
      .where('reset_password_token', token)
      .where('reset_password_expires', '>', new Date())
      .first();
    
    if (!user) return null;
    
    // Verify token signature
    try {
      jwt.verify(token, process.env.JWT_SECRET + user.password_hash);
      return user;
    } catch (error) {
      logger.error('Error verifying password reset token:', error);
      return null;
    }
  }
  
  // Create email verification token
  static async createEmailVerificationToken(userId) {
    const user = await this.query().findById(userId);
    if (!user || user.email_verified) return null;
    
    // Generate verification token (24 hours expiry)
    const verificationToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET + user.password_hash,
      { expiresIn: '24h' }
    );
    
    // Save verification token to user
    await this.query()
      .findById(user.id)
      .patch({
        verification_token: verificationToken,
        verification_token_expires: new Date(Date.now() + 24 * 3600000) // 24 hours
      });
    
    return verificationToken;
  }
  
  // Verify email with token
  static async verifyEmailWithToken(token) {
    // Find user by token
    const user = await this.query()
      .where('verification_token', token)
      .where('verification_token_expires', '>', new Date())
      .first();
    
    if (!user) return null;
    
    // Verify token signature
    try {
      jwt.verify(token, process.env.JWT_SECRET + user.password_hash);
      
      // Mark email as verified
      await this.query()
        .findById(user.id)
        .patch({
          email_verified: true,
          verification_token: null,
          verification_token_expires: null,
          updated_at: new Date().toISOString()
        });
      
      return user;
    } catch (error) {
      logger.error('Error verifying email token:', error);
      return null;
    }
  }
  
  // Invalidate all user sessions
  static async invalidateSessions(userId) {
    try {
      // Delete all refresh tokens for the user
      await this.relatedQuery('refreshTokens')
        .for(userId)
        .delete();
      
      // Invalidate any active JWT tokens by updating the user's password_updated_at
      // This will make all existing tokens invalid
      await this.query()
        .findById(userId)
        .patch({
          updated_at: new Date().toISOString()
        });
      
      return true;
    } catch (error) {
      logger.error('Error invalidating user sessions:', error);
      return false;
    }
  }
  
  // Get user by credentials (email/phone/document + password)
  static async findByCredentials(identifier, password) {
    const user = await this.query()
      .findOne(builder => {
        builder.where('email', identifier)
          .orWhere('phone', identifier)
          .orWhere('document_id', identifier);
      })
      .first();

    if (!user) {
      throw new Error('Credenciales inválidas');
    }

    const isPasswordMatch = await user.verifyPassword(password);
    if (!isPasswordMatch) {
      throw new Error('Credenciales inválidas');
    }

    if (!user.is_active) {
      throw new Error('La cuenta está desactivada');
    }

    // Update last login
    await user.$query().patch({ last_login: new Date().toISOString() });

    return user;
  }
  
  // Update user password
  async updatePassword(newPassword) {
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(newPassword, salt);
    
    // Update password and invalidate all sessions
    await this.$query().patch({
      password_hash,
      reset_password_token: null,
      reset_password_expires: null,
      updated_at: new Date().toISOString()
    });
    
    // Invalidate all sessions
    await this.constructor.invalidateSessions(this.id);
    
    return true;
  }
}
