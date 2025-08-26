const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { User } = require('../models/User');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const { logger } = require('../utils/logger');
const { createSuccessResponse, createErrorResponse } = require('../utils/apiResponse');

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Límite de 10 solicitudes por ventana
  message: 'Demasiados intentos, por favor intente de nuevo más tarde.'
});

// Middleware para verificar token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json(createErrorResponse('No autorizado', 401));
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json(createErrorResponse('Token expirado', 401));
      }
      return res.status(403).json(createErrorResponse('Token inválido', 403));
    }
    
    req.user = user;
    next();
  });
};

// Middleware para verificar rol de administrador
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json(createErrorResponse('Acceso denegado: se requieren privilegios de administrador', 403));
  }
  next();
};

/**
 * @route POST /api/auth/register
 * @desc Registrar un nuevo usuario
 * @access Public
 */
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('first_name').optional().trim().escape(),
  body('last_name').optional().trim().escape(),
  body('phone').optional().trim().escape(),
  body('document_id').optional().trim().escape(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Datos de entrada inválidos', 400, errors.array()));
    }

    const { email, password, first_name, last_name, phone, document_id } = req.body;

    // Verificar si el usuario ya existe
    const existingUser = await User.query().findOne({ email });
    if (existingUser) {
      return res.status(400).json(createErrorResponse('El correo electrónico ya está registrado', 400));
    }

    // Crear nuevo usuario
    const user = await User.query().insert({
      email,
      password, // El hash se maneja en el modelo
      first_name,
      last_name,
      phone,
      document_id,
      is_active: true,
      email_verified: false
    });

    // Generar token de verificación
    const verificationToken = await User.createEmailVerificationToken(user.id);
    
    // Enviar correo de verificación
    await sendVerificationEmail(user.email, verificationToken, user.first_name);

    // Generar tokens de autenticación
    const accessToken = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Guardar refresh token en la base de datos
    await user.$relatedQuery('refreshTokens').insert({
      token: refreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
      user_agent: req.headers['user-agent']
    });

    // Enviar respuesta
    res.status(201).json(createSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        email_verified: user.email_verified
      },
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600 // 1 hora
      }
    }, 'Usuario registrado exitosamente. Por favor verifica tu correo electrónico.'));

  } catch (error) {
    logger.error('Error en el registro de usuario:', error);
    res.status(500).json(createErrorResponse('Error al registrar el usuario'));
  }
});

/**
 * @route POST /api/auth/login
 * @desc Iniciar sesión de usuario
 * @access Public
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], authLimiter, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Datos de inicio de sesión inválidos', 400, errors.array()));
    }

    const { email, password } = req.body;

    // Verificar credenciales
    const user = await User.findByCredentials(email, password);

    // Generar tokens
    const accessToken = user.generateAuthToken();
    const refreshToken = user.generateRefreshToken();

    // Guardar refresh token en la base de datos
    await user.$relatedQuery('refreshTokens').insert({
      token: refreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
      user_agent: req.headers['user-agent']
    });

    // Enviar respuesta
    res.json(createSuccessResponse({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        email_verified: user.email_verified
      },
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600 // 1 hora
      }
    }));

  } catch (error) {
    logger.error('Error en el inicio de sesión:', error);
    res.status(401).json(createErrorResponse('Credenciales inválidas', 401));
  }
});

/**
 * @route POST /api/auth/refresh-token
 * @desc Obtener un nuevo token de acceso usando el refresh token
 * @access Public
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    
    if (!refresh_token) {
      return res.status(400).json(createErrorResponse('Se requiere un refresh token', 400));
    }

    // Verificar el refresh token
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    const user = await User.query().findById(decoded.id);
    
    if (!user) {
      return res.status(401).json(createErrorResponse('Token de actualización inválido', 401));
    }

    // Verificar si el token existe en la base de datos
    const tokenExists = await user.$relatedQuery('refreshTokens')
      .where('token', refresh_token)
      .where('expires_at', '>', new Date())
      .first();

    if (!tokenExists) {
      return res.status(401).json(createErrorResponse('Token de actualización expirado o inválido', 401));
    }

    // Generar nuevos tokens
    const newAccessToken = user.generateAuthToken();
    const newRefreshToken = user.generateRefreshToken();

    // Eliminar el refresh token antiguo
    await user.$relatedQuery('refreshTokens')
      .where('token', refresh_token)
      .delete();

    // Guardar el nuevo refresh token
    await user.$relatedQuery('refreshTokens').insert({
      token: newRefreshToken,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
      user_agent: req.headers['user-agent']
    });

    // Enviar respuesta
    res.json(createSuccessResponse({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      expires_in: 3600 // 1 hora
    }));

  } catch (error) {
    logger.error('Error al actualizar token:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createErrorResponse('Token de actualización expirado', 401));
    }
    res.status(401).json(createErrorResponse('Token de actualización inválido', 401));
  }
});

/**
 * @route POST /api/auth/logout
 * @desc Cerrar sesión del usuario actual
 * @access Private
 */
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(400).json(createErrorResponse('Token no proporcionado', 400));
    }

    // Obtener el usuario actual
    const user = await User.query().findById(req.user.id);
    
    if (!user) {
      return res.status(404).json(createErrorResponse('Usuario no encontrado', 404));
    }

    // Eliminar el refresh token actual
    await user.$relatedQuery('refreshTokens')
      .where('token', token)
      .delete();

    res.json(createSuccessResponse(null, 'Sesión cerrada exitosamente'));
  } catch (error) {
    logger.error('Error al cerrar sesión:', error);
    res.status(500).json(createErrorResponse('Error al cerrar sesión'));
  }
});

/**
 * @route POST /api/auth/request-password-reset
 * @desc Solicitar restablecimiento de contraseña
 * @access Public
 */
router.post('/request-password-reset', [
  body('email').isEmail().normalizeEmail()
], authLimiter, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Correo electrónico inválido', 400, errors.array()));
    }

    const { email } = req.body;
    
    // Crear token de restablecimiento
    const result = await User.createPasswordResetToken(email);
    
    if (!result) {
      // No revelar si el correo existe o no por seguridad
      return res.json(createSuccessResponse(null, 'Si el correo existe, se ha enviado un enlace para restablecer la contraseña'));
    }

    const { user, resetToken } = result;
    
    // Enviar correo electrónico
    await sendPasswordResetEmail(user.email, resetToken, user.first_name);

    res.json(createSuccessResponse(null, 'Se ha enviado un enlace para restablecer la contraseña a tu correo electrónico'));
  } catch (error) {
    logger.error('Error al solicitar restablecimiento de contraseña:', error);
    res.status(500).json(createErrorResponse('Error al procesar la solicitud'));
  }
});

/**
 * @route POST /api/auth/reset-password
 * @desc Restablecer contraseña con token
 * @access Public
 */
router.post('/reset-password', [
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(createErrorResponse('Datos inválidos', 400, errors.array()));
    }

    const { token, newPassword } = req.body;
    
    // Verificar token
    const user = await User.verifyPasswordResetToken(token);
    
    if (!user) {
      return res.status(400).json(createErrorResponse('Token inválido o expirado', 400));
    }

    // Actualizar contraseña
    await user.updatePassword(newPassword);

    res.json(createSuccessResponse(null, 'Contraseña actualizada exitosamente'));
  } catch (error) {
    logger.error('Error al restablecer contraseña:', error);
    res.status(500).json(createErrorResponse('Error al restablecer la contraseña'));
  }
});

/**
 * @route GET /api/auth/verify-email
 * @desc Verificar correo electrónico con token
 * @access Public
 */
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json(createErrorResponse('Token no proporcionado', 400));
    }

    // Verificar token
    const user = await User.verifyEmailWithToken(token);
    
    if (!user) {
      return res.status(400).json(createErrorResponse('Token inválido o expirado', 400));
    }

    // Redirigir al frontend con mensaje de éxito
    res.redirect(`${process.env.FRONTEND_URL}/auth/email-verified?success=true`);
  } catch (error) {
    logger.error('Error al verificar correo electrónico:', error);
    res.redirect(`${process.env.FRONTEND_URL}/auth/email-verified?success=false`);
  }
});

/**
 * @route POST /api/auth/resend-verification
 * @desc Reenviar correo de verificación
 * @access Private
 */
router.post('/resend-verification', authenticateToken, async (req, res) => {
  try {
    const user = await User.query().findById(req.user.id);
    
    if (!user) {
      return res.status(404).json(createErrorResponse('Usuario no encontrado', 404));
    }

    if (user.email_verified) {
      return res.status(400).json(createErrorResponse('El correo electrónico ya ha sido verificado', 400));
    }

    // Generar nuevo token de verificación
    const verificationToken = await User.createEmailVerificationToken(user.id);
    
    if (!verificationToken) {
      return res.status(400).json(createErrorResponse('No se pudo generar el token de verificación', 400));
    }

    // Enviar correo de verificación
    await sendVerificationEmail(user.email, verificationToken, user.first_name);

    res.json(createSuccessResponse(null, 'Se ha enviado un nuevo correo de verificación'));
  } catch (error) {
    logger.error('Error al reenviar correo de verificación:', error);
    res.status(500).json(createErrorResponse('Error al procesar la solicitud'));
  }
});

/**
 * @route GET /api/auth/me
 * @desc Obtener información del usuario actual
 * @access Private
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.query()
      .findById(req.user.id)
      .select('id', 'email', 'first_name', 'last_name', 'email_verified', 'created_at');
    
    if (!user) {
      return res.status(404).json(createErrorResponse('Usuario no encontrado', 404));
    }

    res.json(createSuccessResponse({ user }));
  } catch (error) {
    logger.error('Error al obtener información del usuario:', error);
    res.status(500).json(createErrorResponse('Error al obtener la información del usuario'));
  }
});

module.exports = router;
