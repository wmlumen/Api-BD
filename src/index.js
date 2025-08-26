#!/usr/bin/env node

import dotenv from 'dotenv';
import { logger } from './utils/logger.js';

// Load environment variables from .env file
dotenv.config();

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  // Close server and exit process
  process.exit(1);
});

// Import the server after environment variables are loaded
import('./server.js').then(({ default: server }) => {
  // Server is now running
}).catch(err => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
