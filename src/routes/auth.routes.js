import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../utils/email.js';

const router = Router();

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - document_id
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               document_id:
 *                 type: string
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or user already exists
 *       500:
 *         description: Server error
 */
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('document_id').notEmpty(),
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          errors: errors.array() 
        });
      }

      const { email, password, document_id, first_name, last_name, phone } = req.body;

      // Check if user already exists
      const existingUser = await User.query()
        .where('email', email)
        .orWhere('document_id', document_id)
        .orWhere('phone', phone)
        .first();

      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          error: 'User with this email, document ID, or phone already exists' 
        });
      }

      // Create user
      const user = await User.query().insert({
        email,
        document_id,
        first_name,
        last_name,
        phone,
        password, // Password will be hashed in the model hook
        is_active: true,
        email_verified: false, // Email verification would be handled separately
      });

      // Generate JWT token
      const token = user.generateAuthToken();
      const refreshToken = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
      );

      // Return user info and token (exclude password hash)
      const { password_hash, ...userData } = user;
      
      res.status(201).json({
        success: true,
        data: {
          user: userData,
          token,
          refreshToken,
        },
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to register user' 
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Authenticate user and get token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - password
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email, phone, or document ID
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Authentication successful
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post(
  '/login',
  [
    body('identifier').notEmpty(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    try {
      const { identifier, password } = req.body;

      // Find user by email, phone, or document ID
      const user = await User.query()
        .where('email', identifier)
        .orWhere('phone', identifier)
        .orWhere('document_id', identifier)
        .first();

      if (!user || !(await user.verifyPassword(password))) {
        return res.status(401).json({ 
          success: false, 
          error: 'Invalid credentials' 
        });
      }

      if (!user.is_active) {
        return res.status(403).json({ 
          success: false, 
          error: 'Account is deactivated' 
        });
      }

      // Update last login
      await user.$query().patch({ last_login: new Date().toISOString() });

      // Generate tokens
      const token = user.generateAuthToken();
      const refreshToken = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
      );

      // Return user info and tokens (exclude password hash)
      const { password_hash, ...userData } = user;
      
      res.json({
        success: true,
        data: {
          user: userData,
          token,
          refreshToken,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Authentication failed' 
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh-token', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    // Generate new tokens
    const token = user.generateAuthToken();
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' }
    );

    res.json({
      success: true,
      data: {
        token,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired refresh token' 
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current user info
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information
 *       401:
 *         description: Not authenticated
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = req.user;
    const { password_hash, ...userData } = user;
    
    // Get user's projects
    const projects = await user.$relatedQuery('projects');
    
    res.json({
      success: true,
      data: {
        user: userData,
        projects,
      },
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get user information' 
    });
  }
});

/**
 * @swagger
 * /api/v1/auth/request-password-reset:
 *   post:
 *     summary: Request password reset
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: If the email exists, a password reset link has been sent
 *       500:
 *         description: Server error
 */
router.post(
  '/request-password-reset',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Demasiados intentos, por favor intente de nuevo más tarde.'
  }),
  [
    body('email').isEmail().normalizeEmail(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          errors: errors.array() 
        });
      }

      const { email } = req.body;
      const user = await User.query().findOne({ email });
      
      if (user) {
        // Generate reset token (1 hour expiry)
        const resetToken = jwt.sign(
          { id: user.id },
          process.env.JWT_SECRET + user.password_hash,
          { expiresIn: '1h' }
        );
        
        // Save reset token to user
        await User.query()
          .findById(user.id)
          .patch({
            reset_password_token: resetToken,
            reset_password_expires: new Date(Date.now() + 3600000) // 1 hour
          });
        
        // Send password reset email
        await sendPasswordResetEmail(user.email, user.first_name, resetToken);
      }
      
      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: 'Si el correo existe, se ha enviado un enlace para restablecer la contraseña',
      });
    } catch (error) {
      console.error('Password reset request error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error al procesar la solicitud de restablecimiento de contraseña' 
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 *       500:
 *         description: Server error
 */
router.post(
  '/reset-password',
  [
    body('token').notEmpty(),
    body('newPassword').isLength({ min: 8 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          errors: errors.array() 
        });
      }

      const { token, newPassword } = req.body;
      
      // Find user by reset token
      const user = await User.query()
        .where('reset_password_token', token)
        .where('reset_password_expires', '>', new Date())
        .first();
      
      if (!user) {
        return res.status(400).json({ 
          success: false, 
          error: 'El token de restablecimiento es inválido o ha expirado' 
        });
      }
      
      // Update password
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(newPassword, salt);
      
      await User.query()
        .findById(user.id)
        .patch({
          password_hash,
          reset_password_token: null,
          reset_password_expires: null,
          updated_at: new Date().toISOString()
        });
      
      // Invalidate all user sessions
      await User.invalidateSessions(user.id);
      
      res.json({
        success: true,
        message: 'Contraseña restablecida correctamente',
      });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error al restablecer la contraseña' 
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/verify-email:
 *   get:
 *     summary: Verify email with token
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 *       500:
 *         description: Server error
 */
router.get(
  '/verify-email',
  async (req, res) => {
    try {
      const { token } = req.query;
      
      if (!token) {
        return res.status(400).json({ 
          success: false, 
          error: 'Token de verificación no proporcionado' 
        });
      }
      
      // Find user by verification token
      const user = await User.query()
        .where('verification_token', token)
        .first();
      
      if (!user) {
        return res.status(400).json({ 
          success: false, 
          error: 'Token de verificación inválido o expirado' 
        });
      }
      
      // Check if already verified
      if (user.email_verified) {
        return res.json({
          success: true,
          message: 'El correo electrónico ya ha sido verificado anteriormente',
        });
      }
      
      // Mark email as verified
      await User.query()
        .findById(user.id)
        .patch({
          email_verified: true,
          verification_token: null,
          updated_at: new Date().toISOString()
        });
      
      // Redirect to success page or return success response
      res.redirect(`${process.env.FRONTEND_URL}/auth/email-verified`);
    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error al verificar el correo electrónico' 
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/auth/resend-verification:
 *   post:
 *     summary: Resend verification email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Verification email sent if account exists
 *       500:
 *         description: Server error
 */
router.post(
  '/resend-verification',
  rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // limit each IP to 3 requests per hour
    message: 'Demasiadas solicitudes, por favor intente de nuevo más tarde.'
  }),
  [
    body('email').isEmail().normalizeEmail(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          errors: errors.array() 
        });
      }

      const { email } = req.body;
      const user = await User.query().findOne({ email });
      
      if (user && !user.email_verified) {
        // Generate new verification token if none exists
        let verificationToken = user.verification_token;
        
        if (!verificationToken) {
          verificationToken = jwt.sign(
            { id: user.id },
            process.env.JWT_SECRET + user.password_hash,
            { expiresIn: '24h' }
          );
          
          await User.query()
            .findById(user.id)
            .patch({ verification_token: verificationToken });
        }
        
        // Send verification email
        await sendVerificationEmail(user.email, user.first_name, verificationToken);
      }
      
      // Always return success to prevent email enumeration
      res.json({
        success: true,
        message: 'Si el correo existe y no está verificado, se ha enviado un nuevo enlace de verificación',
      });
    } catch (error) {
      console.error('Resend verification error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Error al procesar la solicitud de reenvío de verificación' 
      });
    }
  }
);

export default router;
