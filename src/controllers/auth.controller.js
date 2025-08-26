import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { ApiError } from '../middleware/error.js';
import { logger } from '../utils/logger.js';

// Configuración de tiempos de expiración (en segundos)
const TOKEN_EXPIRATION = 3600; // 1 hora
const REFRESH_TOKEN_EXPIRATION = 86400 * 7; // 7 días

// Generar tokens JWT
const generateTokens = (userId, email) => {
  const accessToken = jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRATION }
  );
  
  const refreshToken = jwt.sign(
    { userId, email, tokenId: uuidv4() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRATION }
  );
  
  return { accessToken, refreshToken };
};

// Registrar un nuevo usuario
export const register = async (req, res, next) => {
  try {
    const { email, password, document_id, first_name, last_name, phone } = req.body;
    
    // Verificar si el usuario ya existe
    const existingUser = await db('users')
      .where('email', email)
      .orWhere('document_id', document_id)
      .first();
    
    if (existingUser) {
      throw new ApiError(400, 'El correo electrónico o documento ya está registrado');
    }
    
    // Hashear la contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Crear el usuario
    const [userId] = await db('users').insert({
      email,
      password_hash: hashedPassword,
      document_id,
      first_name,
      last_name,
      phone,
      is_active: true,
      email_verified: false, // Requiere verificación de correo
      verification_token: uuidv4(),
    }).returning('id');
    
    // Generar tokens
    const { accessToken, refreshToken } = generateTokens(userId, email);
    
    // Guardar el refresh token en la base de datos
    await db('refresh_tokens').insert({
      user_id: userId,
      token: refreshToken,
      expires_at: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000),
    });
    
    // Enviar correo de verificación
    // Nota: Implementar la función sendVerificationEmail
    
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: userId,
          email,
          first_name,
          last_name,
        },
        token: accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Iniciar sesión
export const login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    
    // Buscar usuario por email, teléfono o documento
    const user = await db('users')
      .where('email', identifier)
      .orWhere('phone', identifier)
      .orWhere('document_id', identifier)
      .first();
    
    if (!user) {
      throw new ApiError(401, 'Credenciales inválidas');
    }
    
    // Verificar contraseña
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      throw new ApiError(401, 'Credenciales inválidas');
    }
    
    // Verificar si el usuario está activo
    if (!user.is_active) {
      throw new ApiError(403, 'La cuenta está desactivada');
    }
    
    // Generar tokens
    const { accessToken, refreshToken } = generateTokens(user.id, user.email);
    
    // Guardar el refresh token en la base de datos
    await db('refresh_tokens').insert({
      user_id: user.id,
      token: refreshToken,
      expires_at: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000),
    });
    
    // Registrar inicio de sesión exitoso
    logger.info(`Usuario ${user.email} ha iniciado sesión`, { userId: user.id });
    
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          email_verified: user.email_verified,
        },
        token: accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    logger.error('Error en el inicio de sesión:', error);
    next(error);
  }
};

// Refrescar token de acceso
export const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      throw new ApiError(400, 'Token de actualización no proporcionado');
    }
    
    // Verificar el refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Verificar si el token existe en la base de datos
    const tokenRecord = await db('refresh_tokens')
      .where('token', refreshToken)
      .where('expires_at', '>', new Date())
      .first();
    
    if (!tokenRecord) {
      throw new ApiError(401, 'Token de actualización inválido o expirado');
    }
    
    // Obtener información del usuario
    const user = await db('users')
      .where('id', decoded.userId)
      .first();
    
    if (!user || !user.is_active) {
      throw new ApiError(401, 'Usuario no encontrado o inactivo');
    }
    
    // Generar nuevos tokens
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.email);
    
    // Actualizar el refresh token en la base de datos
    await db('refresh_tokens')
      .where('token', refreshToken)
      .update({
        token: newRefreshToken,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_EXPIRATION * 1000),
        updated_at: new Date(),
      });
    
    res.json({
      success: true,
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (error) {
    logger.error('Error al actualizar token:', error);
    next(error);
  }
};

// Cerrar sesión
export const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      throw new ApiError(400, 'Token de actualización no proporcionado');
    }
    
    // Eliminar el refresh token de la base de datos
    await db('refresh_tokens')
      .where('token', refreshToken)
      .delete();
    
    res.json({
      success: true,
      message: 'Sesión cerrada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

// Solicitar restablecimiento de contraseña
export const requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    // Buscar usuario por correo electrónico
    const user = await db('users')
      .where('email', email)
      .first();
    
    // Por seguridad, no revelar si el correo existe o no
    if (!user) {
      return res.json({
        success: true,
        message: 'Si el correo existe, se ha enviado un enlace para restablecer la contraseña',
      });
    }
    
    // Generar token de restablecimiento
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hora de expiración
    
    // Guardar el token en la base de datos
    await db('users')
      .where('id', user.id)
      .update({
        reset_password_token: resetToken,
        reset_password_expires: resetTokenExpiry,
      });
    
    // Enviar correo electrónico con el enlace de restablecimiento
    await sendPasswordResetEmail(user.email, user.first_name, resetToken);
    
    // Registrar la solicitud de restablecimiento
    logger.info(`Solicitud de restablecimiento de contraseña para ${user.email}`, { userId: user.id });
    
    res.json({
      success: true,
      message: 'Si el correo existe, se ha enviado un enlace para restablecer la contraseña',
    });
  } catch (error) {
    logger.error('Error al solicitar restablecimiento de contraseña:', error);
    next(error);
  }
};

// Restablecer contraseña
export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      throw new ApiError(400, 'Token y nueva contraseña son requeridos');
    }
    
    // Buscar usuario por token de restablecimiento
    const user = await db('users')
      .where('reset_password_token', token)
      .where('reset_password_expires', '>', new Date())
      .first();
    
    if (!user) {
      throw new ApiError(400, 'El token de restablecimiento es inválido o ha expirado');
    }
    
    // Hashear la nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Actualizar la contraseña y limpiar el token
    await db('users')
      .where('id', user.id)
      .update({
        password_hash: hashedPassword,
        reset_password_token: null,
        reset_password_expires: null,
        updated_at: new Date(),
      });
    
    // Invalidar todos los tokens de sesión existentes
    await db('refresh_tokens')
      .where('user_id', user.id)
      .delete();
    
    // Registrar el cambio de contraseña
    logger.info(`Contraseña restablecida para el usuario ${user.email}`, { userId: user.id });
    
    res.json({
      success: true,
      message: 'Contraseña restablecida correctamente',
    });
  } catch (error) {
    logger.error('Error al restablecer la contraseña:', error);
    next(error);
  }
};

// Verificar correo electrónico
export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      throw new ApiError(400, 'Token de verificación no proporcionado');
    }
    
    // Buscar usuario por token de verificación
    const user = await db('users')
      .where('verification_token', token)
      .first();
    
    if (!user) {
      throw new ApiError(400, 'Token de verificación inválido');
    }
    
    // Verificar si el correo ya está verificado
    if (user.email_verified) {
      return res.json({
        success: true,
        message: 'El correo electrónico ya ha sido verificado anteriormente',
      });
    }
    
    // Marcar el correo como verificado
    await db('users')
      .where('id', user.id)
      .update({
        email_verified: true,
        verification_token: null,
        updated_at: new Date(),
      });
    
    // Registrar la verificación de correo
    logger.info(`Correo verificado para el usuario ${user.email}`, { userId: user.id });
    
    res.json({
      success: true,
      message: 'Correo electrónico verificado correctamente',
    });
  } catch (error) {
    logger.error('Error al verificar el correo electrónico:', error);
    next(error);
  }
};

// Reenviar correo de verificación
export const resendVerificationEmail = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      throw new ApiError(400, 'Correo electrónico es requerido');
    }
    
    // Buscar usuario por correo electrónico
    const user = await db('users')
      .where('email', email)
      .first();
    
    if (!user) {
      // Por seguridad, no revelar si el correo existe o no
      return res.json({
        success: true,
        message: 'Si el correo existe, se ha enviado un enlace de verificación',
      });
    }
    
    // Verificar si el correo ya está verificado
    if (user.email_verified) {
      return res.json({
        success: true,
        message: 'El correo electrónico ya ha sido verificado',
      });
    }
    
    // Generar un nuevo token de verificación si no existe
    let verificationToken = user.verification_token;
    if (!verificationToken) {
      verificationToken = uuidv4();
      
      await db('users')
        .where('id', user.id)
        .update({
          verification_token: verificationToken,
        });
    }
    
    // Enviar correo de verificación
    // Nota: Implementar la función sendVerificationEmail
    
    // Registrar el reenvío del correo de verificación
    logger.info(`Correo de verificación reenviado a ${user.email}`, { userId: user.id });
    
    res.json({
      success: true,
      message: 'Si el correo existe, se ha enviado un enlace de verificación',
    });
  } catch (error) {
    logger.error('Error al reenviar el correo de verificación:', error);
    next(error);
  }
};
