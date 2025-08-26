/**
 * Success response handler
 * @param {Object} res - Express response object
 * @param {*} data - Data to send in the response
 * @param {string} message - Optional success message
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} JSON response
 */
export const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message,
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * Error response handler
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {*} error - Original error object (optional)
 * @param {Array} errors - Array of validation errors (optional)
 * @returns {Object} JSON response
 */
export const errorResponse = (res, message = 'An error occurred', statusCode = 500, error = null, errors = []) => {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };

  // Include error details in development
  if (process.env.NODE_ENV === 'development' && error) {
    response.error = {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }

  // Include validation errors if present
  if (errors.length > 0) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Validation error response
 * @param {Object} res - Express response object
 * @param {Array} errors - Array of validation errors
 * @returns {Object} JSON response with 400 status code
 */
export const validationError = (res, errors = []) => {
  return errorResponse(
    res,
    'Validation failed',
    400,
    null,
    errors.map(err => ({
      field: err.param,
      message: err.msg,
      value: err.value,
    }))
  );
};

/**
 * Not found response
 * @param {Object} res - Express response object
 * @param {string} resource - Name of the resource not found
 * @returns {Object} JSON response with 404 status code
 */
export const notFoundResponse = (res, resource = 'Resource') => {
  return errorResponse(res, `${resource} not found`, 404);
};

/**
 * Unauthorized response
 * @param {Object} res - Express response object
 * @param {string} message - Custom message (optional)
 * @returns {Object} JSON response with 401 status code
 */
export const unauthorizedResponse = (res, message = 'Unauthorized') => {
  return errorResponse(res, message, 401);
};

/**
 * Forbidden response
 * @param {Object} res - Express response object
 * @param {string} message - Custom message (optional)
 * @returns {Object} JSON response with 403 status code
 */
export const forbiddenResponse = (res, message = 'Forbidden') => {
  return errorResponse(res, message, 403);
};

/**
 * Bad request response
 * @param {Object} res - Express response object
 * @param {string} message - Custom message (optional)
 * @param {*} error - Original error object (optional)
 * @returns {Object} JSON response with 400 status code
 */
export const badRequestResponse = (res, message = 'Bad request', error = null) => {
  return errorResponse(res, message, 400, error);
};

/**
 * Internal server error response
 * @param {Object} res - Express response object
 * @param {Error} error - Error object
 * @returns {Object} JSON response with 500 status code
 */
export const serverErrorResponse = (res, error) => {
  console.error('Server error:', error);
  return errorResponse(
    res,
    process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message,
    500,
    process.env.NODE_ENV === 'development' ? error : null
  );
};

/**
 * Pagination response
 * @param {Object} res - Express response object
 * @param {Array} data - Array of items
 * @param {number} page - Current page number
 * @param {number} limit - Number of items per page
 * @param {number} total - Total number of items
 * @param {string} message - Custom message (optional)
 * @returns {Object} JSON response with pagination data
 */
export const paginatedResponse = (res, data, page, limit, total, message = 'Success') => {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  return successResponse(
    res,
    {
      items: data,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: total,
        totalPages,
        hasNext,
        hasPrevious,
      },
    },
    message
  );
};
