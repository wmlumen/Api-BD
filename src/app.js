import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { createRequire } from 'module';

// Import routes
import authRoutes from './routes/auth.routes.js';
import projectRoutes from './routes/project.routes.js';
import queryRoutes from './routes/query.routes.js';
import metaRoutes from './routes/meta.routes.js';

// Import middleware
import { errorHandler, notFoundHandler } from './middleware/error.js';

export default function createApp() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  const app = express();
  
  // Trust proxy if behind a reverse proxy (e.g., Nginx, Heroku)
  app.set('trust proxy', 1);
  
  // Security middleware
  app.use(helmet());
  
  // CORS configuration
  const corsOptions = {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Project-Id', 'X-API-Key'],
    credentials: true,
  };
  app.use(cors(corsOptions));
  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { 
      success: false, 
      error: 'Too many requests, please try again later.' 
    },
  });
  
  // Apply rate limiting to all API routes
  app.use('/api', limiter);
  
  // Request logging
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  
  // Parse JSON bodies
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  });
  
  // API documentation - Swagger
  try {
    const swaggerDocument = YAML.load(path.join(__dirname, '../docs/swagger.yaml'));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  } catch (error) {
    console.warn('Failed to load Swagger documentation:', error.message);
  }
  
  // API routes
  const apiRouter = express.Router();
  
  // API versioning
  const v1Router = express.Router();
  
  // Mount routes
  v1Router.use('/auth', authRoutes);
  v1Router.use('/projects', projectRoutes);
  v1Router.use('/query', queryRoutes);
  v1Router.use('/meta', metaRoutes);
  
  // Mount versioned API
  apiRouter.use('/v1', v1Router);
  
  // Mount API router
  app.use('/api', apiRouter);
  
  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../public')));
    
    // Handle SPA routing
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }
  
  // 404 handler
  app.use(notFoundHandler);
  
  // Global error handler
  app.use(errorHandler);
  
  return app;
}
