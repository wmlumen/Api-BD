/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(statusCode, message, isOperational = true, stack = '') {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

/**
 * Global error handler
 */
export const errorHandler = (err, req, res, next) => {
  // Default status code and message
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message;
  let errors = [];
  let stack = {};

  // Handle specific error types
  if (err.name === 'ValidationError') {
    // Mongoose validation error
    statusCode = 400;
    message = 'Validation failed';
    errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
      type: e.kind,
    }));
  } else if (err.name === 'CastError') {
    // Mongoose cast error (invalid ObjectId, etc.)
    statusCode = 400;
    message = 'Invalid ID format';
    errors = [{
      field: err.path,
      message: `Invalid ${err.path}: ${err.value}`,
      type: 'cast_error',
    }];
  } else if (err.name === 'JsonWebTokenError') {
    // JWT error
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    // JWT expired
    statusCode = 401;
    message = 'Token expired';
  } else if (err.code === '23505') {
    // PostgreSQL unique violation
    statusCode = 409;
    message = 'Duplicate key error';
    const match = err.detail.match(/Key \(([^)]+)\)=\([^)]+\)/);
    const field = match ? match[1] : 'unknown';
    errors = [{
      field,
      message: `${field} already exists`,
      type: 'unique_violation',
    }];
  } else if (err.code === '23503') {
    // PostgreSQL foreign key violation
    statusCode = 400;
    message = 'Reference error';
    errors = [{
      message: 'The operation violates a foreign key constraint',
      type: 'foreign_key_violation',
      details: err.detail,
    }];
  } else if (err.code === '22P02') {
    // PostgreSQL invalid text representation
    statusCode = 400;
    message = 'Invalid input syntax';
  } else if (err.code === '42703') {
    // PostgreSQL undefined column
    statusCode = 400;
    message = 'Invalid column reference';
    errors = [{
      message: `Column does not exist: ${err.column}`,
      type: 'undefined_column',
    }];
  } else if (err.code === '42P01') {
    // PostgreSQL undefined table
    statusCode = 400;
    message = 'Invalid table reference';
    errors = [{
      message: `Table does not exist: ${err.table}`,
      type: 'undefined_table',
    }];
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    stack = {
      message: err.message,
      stack: err.stack,
      name: err.name,
      ...(err.errors && { errors: err.errors }),
    };
  }

  // Log error in production for non-operational errors
  if (process.env.NODE_ENV === 'production' && !err.isOperational) {
    console.error('Unhandled error:', {
      message: err.message,
      name: err.name,
      stack: err.stack,
      request: {
        method: req.method,
        url: req.originalUrl,
        params: req.params,
        query: req.query,
        body: req.body,
        user: req.user ? { id: req.user.id, email: req.user.email } : null,
      },
    });
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(errors.length > 0 && { errors }),
    ...(process.env.NODE_ENV === 'development' && { stack }),
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
};

/**
 * Async handler to wrap async/await route handlers and catch errors
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped route handler with error handling
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Custom error handler for 404 routes
 */
export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};
