import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { promisify } from 'util';
import { logger } from './logger.js';

const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  await mkdir(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

// File filter to allow only certain file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/json',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images, PDFs, and spreadsheets are allowed.'), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * Middleware for handling file uploads
 * @param {string} fieldName - Name of the file field in the form
 * @param {number} maxCount - Maximum number of files (default: 1)
 * @returns {Function} Express middleware
 */
export const uploadFile = (fieldName, maxCount = 1) => {
  return (req, res, next) => {
    const uploadHandler = upload.array(fieldName, maxCount);
    
    uploadHandler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        // A Multer error occurred when uploading
        return res.status(400).json({
          success: false,
          error: err.message,
        });
      } else if (err) {
        // An unknown error occurred
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }
      
      // If no files were uploaded, continue
      if (!req.files || req.files.length === 0) {
        return next();
      }
      
      // Add file information to the request
      req.uploadedFiles = req.files.map(file => ({
        originalname: file.originalname,
        filename: file.filename,
        path: file.path,
        size: file.size,
        mimetype: file.mimetype,
        url: `/uploads/${file.filename}`,
      }));
      
      next();
    });
  };
};

/**
 * Delete a file from the uploads directory
 * @param {string} filename - Name of the file to delete
 * @returns {Promise<boolean>} True if file was deleted, false otherwise
 */
export const deleteFile = async (filename) => {
  try {
    const filePath = path.join(uploadsDir, filename);
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
      await unlink(filePath);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Error deleting file ${filename}:`, error);
    return false;
  }
};

/**
 * Get the full path to an uploaded file
 * @param {string} filename - Name of the file
 * @returns {string} Full path to the file
 */
export const getFilePath = (filename) => {
  return path.join(uploadsDir, filename);
};

/**
 * Middleware to serve uploaded files
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
export const serveFile = (req, res, next) => {
  const { filename } = req.params;
  const filePath = getFilePath(filename);
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: 'File not found',
    });
  }
  
  // Set appropriate headers
  const ext = path.extname(filename).toLowerCase();
  let contentType = 'application/octet-stream';
  
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      contentType = 'image/jpeg';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.gif':
      contentType = 'image/gif';
      break;
    case '.pdf':
      contentType = 'application/pdf';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.csv':
      contentType = 'text/csv';
      break;
    case '.xls':
      contentType = 'application/vnd.ms-excel';
      break;
    case '.xlsx':
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      break;
  }
  
  res.setHeader('Content-Type', contentType);
  res.sendFile(filePath);
};

/**
 * Clean up old temporary files
 * @param {number} maxAge - Maximum age of files to keep in milliseconds (default: 24 hours)
 */
export const cleanupTempFiles = async (maxAge = 24 * 60 * 60 * 1000) => {
  try {
    const now = Date.now();
    const files = await fs.promises.readdir(uploadsDir);
    
    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stats = await fs.promises.stat(filePath);
      
      // Delete files older than maxAge
      if (now - stats.mtimeMs > maxAge) {
        await unlink(filePath);
        logger.info(`Deleted old temporary file: ${file}`);
      }
    }
  } catch (error) {
    logger.error('Error cleaning up temporary files:', error);
  }
};

// Schedule cleanup of temporary files (run once per day)
setInterval(() => cleanupTempFiles(), 24 * 60 * 60 * 1000);

// Initial cleanup
cleanupTempFiles().catch(error => {
  logger.error('Initial cleanup failed:', error);
});
