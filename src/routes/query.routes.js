import { Router } from 'express';
import { body, param, query as q, validationResult } from 'express-validator';
import { Project, ProjectDatabase } from '../models/index.js';
import { authenticate, authorizeProject } from '../middleware/auth.js';
import AIService from '../services/AIService.js';
import knex from 'knex';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Cache for database connections
const dbConnections = new Map();

/**
 * Get or create a database connection
 * @param {string} projectId - Project ID
 * @param {string} databaseId - Database ID
 * @returns {Promise<import('knex').Knex>} Knex instance
 */
async function getDbConnection(projectId, databaseId) {
  const cacheKey = `${projectId}:${databaseId}`;
  
  // Return cached connection if available
  if (dbConnections.has(cacheKey)) {
    return dbConnections.get(cacheKey);
  }

  // Get database config
  const database = await ProjectDatabase.query()
    .findById(databaseId)
    .where('project_id', projectId);

  if (!database) {
    throw new Error('Database not found or access denied');
  }

  // Create Knex connection
  const connection = knex({
    client: database.type,
    connection: {
      ...database.connection_config,
      // Add SSL if needed
      ssl: database.connection_config.ssl ? { rejectUnauthorized: false } : false,
    },
    pool: {
      min: 0,
      max: 7, // Adjust based on your needs
    },
    debug: process.env.NODE_ENV === 'development',
  });

  // Test the connection
  try {
    await connection.raw('SELECT 1');
  } catch (error) {
    connection.destroy();
    throw new Error(`Failed to connect to database: ${error.message}`);
  }

  // Cache the connection
  dbConnections.set(cacheKey, connection);
  return connection;
}

/**
 * Clean up database connections on server shutdown
 */
function cleanupDbConnections() {
  for (const [key, connection] of dbConnections.entries()) {
    try {
      connection.destroy();
      dbConnections.delete(key);
    } catch (error) {
      console.error('Error closing database connection:', error);
    }
  }
}

// Handle process termination
process.on('SIGTERM', cleanupDbConnections);
process.on('SIGINT', cleanupDbConnections);

/**
 * @swagger
 * /api/v1/query/translate:
 *   post:
 *     summary: Translate natural language to database query
 *     tags: [Queries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *               - project_id
 *             properties:
 *               query:
 *                 type: string
 *                 description: Natural language query
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               database_id:
 *                 type: string
 *                 format: uuid
 *               schema:
 *                 type: object
 *                 description: Optional database schema for better translation
 *     responses:
 *       200:
 *         description: Query translated successfully
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post(
  '/translate',
  [
    body('query').trim().notEmpty(),
    body('project_id').isUUID(),
    body('database_id').optional().isUUID(),
    body('schema').optional().isObject(),
  ],
  authorizeProject('user'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { query, database_id, schema, project_id } = req.body;

      // Get database schema if not provided
      let dbSchema = schema;
      if (!dbSchema && database_id) {
        const db = await getDbConnection(project_id, database_id);
        // This is a simplified example - in a real app, you'd introspect the database
        // to get the actual schema
        const tables = await db.raw(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
        `);
        
        dbSchema = {
          tables: tables.rows.map(t => t.table_name),
          // Add more schema details as needed
        };
      }

      // Translate query using AI
      const result = await AIService.translateQuery(query, {
        schema: dbSchema,
        project_id,
        user_id: req.user.id,
        database_id,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Query translation error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to translate query',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/query/execute:
 *   post:
 *     summary: Execute a database query
 *     tags: [Queries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *               - project_id
 *               - database_id
 *             properties:
 *               query:
 *                 type: string
 *                 description: SQL/NoSQL query to execute
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               database_id:
 *                 type: string
 *                 format: uuid
 *               params:
 *                 type: array
 *                 description: Query parameters (for prepared statements)
 *               is_ai_generated:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Query executed successfully
 *       400:
 *         description: Invalid request or query
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  '/execute',
  [
    body('query').trim().notEmpty(),
    body('project_id').isUUID(),
    body('database_id').isUUID(),
    body('params').optional().isArray(),
    body('is_ai_generated').optional().isBoolean().toBoolean(),
  ],
  authorizeProject('user'),
  async (req, res) => {
    const startTime = Date.now();
    let dbConnection;
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { query, database_id, params = [], is_ai_generated = false, project_id } = req.body;

      // Get database connection
      dbConnection = await getDbConnection(project_id, database_id);

      // Execute query
      const result = await dbConnection.raw(query, params);
      const executionTime = Date.now() - startTime;

      // Log the query
      await Project.relatedQuery('query_history')
        .for(project_id)
        .insert({
          user_id: req.user.id,
          database_id,
          query,
          params: params.length ? params : null,
          result_metadata: {
            row_count: result.rowCount || result.rows?.length || 0,
            execution_time_ms: executionTime,
            is_ai_generated,
          },
        });

      // Format response based on query type
      let data;
      if (query.trim().toLowerCase().startsWith('select') || 
          query.trim().toLowerCase().startsWith('show') ||
          query.trim().toLowerCase().startsWith('describe') ||
          query.trim().toLowerCase().startsWith('explain')) {
        // For SELECT/SHOW/DESCRIBE/EXPLAIN queries, return the rows
        data = result.rows || result;
      } else {
        // For INSERT/UPDATE/DELETE, return the command and row count
        data = {
          command: result.command,
          rowCount: result.rowCount || 0,
        };
      }

      res.json({
        success: true,
        data,
        meta: {
          execution_time_ms: executionTime,
          row_count: result.rowCount || result.rows?.length || 0,
        },
      });
    } catch (error) {
      console.error('Query execution error:', error);
      
      // Log failed query
      try {
        await Project.relatedQuery('query_history')
          .for(req.params.project_id)
          .insert({
            user_id: req.user.id,
            database_id: req.body.database_id,
            query: req.body.query,
            params: req.body.params || null,
            result_metadata: {
              error: error.message,
              execution_time_ms: Date.now() - startTime,
              is_ai_generated: req.body.is_ai_generated || false,
            },
          });
      } catch (logError) {
        console.error('Failed to log query error:', logError);
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to execute query',
        code: error.code,
      });
    } finally {
      // For non-persistent connections, you might want to close the connection
      // For now, we'll keep it in the pool for reuse
    }
  }
);

/**
 * @swagger
 * /api/v1/query/ask:
 *   post:
 *     summary: Ask a question in natural language and get results
 *     tags: [Queries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *               - project_id
 *               - database_id
 *             properties:
 *               question:
 *                 type: string
 *                 description: Natural language question
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               database_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Question answered successfully
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post(
  '/ask',
  [
    body('question').trim().notEmpty(),
    body('project_id').isUUID(),
    body('database_id').isUUID(),
  ],
  authorizeProject('user'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { question, database_id, project_id } = req.body;

      // 1. Get database schema
      const db = await getDbConnection(project_id, database_id);
      const tables = await db.raw(`
        SELECT 
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      // Format schema for AI
      const schema = {};
      tables.rows.forEach(row => {
        if (!schema[row.table_name]) {
          schema[row.table_name] = [];
        }
        schema[row.table_name].push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          default: row.column_default,
        });
      });

      // 2. Translate question to query using AI
      const translation = await AIService.translateQuery(question, {
        schema,
        project_id,
        user_id: req.user.id,
        database_id,
        database_type: 'postgresql', // This should be dynamic based on the actual DB
      });

      // 3. Execute the query
      const queryStartTime = Date.now();
      const result = await db.raw(translation.query, translation.parameters || []);
      const executionTime = Date.now() - queryStartTime;

      // 4. Format the results
      const formattedResults = {
        question,
        query: translation.query,
        parameters: translation.parameters || [],
        data: result.rows || result,
        meta: {
          execution_time_ms: executionTime,
          row_count: result.rowCount || result.rows?.length || 0,
          is_ai_generated: true,
          confidence: translation.confidence,
        },
      };

      // 5. Log the query
      await Project.relatedQuery('query_history')
        .for(project_id)
        .insert({
          user_id: req.user.id,
          database_id,
          query: translation.query,
          params: translation.parameters || null,
          result_metadata: {
            row_count: result.rowCount || result.rows?.length || 0,
            execution_time_ms: executionTime,
            is_ai_generated: true,
            confidence: translation.confidence,
            question,
          },
        });

      res.json({
        success: true,
        data: formattedResults,
      });
    } catch (error) {
      console.error('Ask question error:', error);
      
      // Log the error
      try {
        await Project.relatedQuery('query_history')
          .for(req.params.project_id)
          .insert({
            user_id: req.user.id,
            database_id: req.body.database_id,
            query: 'NATURAL_LANGUAGE_QUERY: ' + req.body.question,
            result_metadata: {
              error: error.message,
              is_ai_generated: true,
            },
          });
      } catch (logError) {
        console.error('Failed to log query error:', logError);
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process your question',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/query/history:
 *   get:
 *     summary: Get query history for a project
 *     tags: [Queries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of history items to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of items to skip
 *     responses:
 *       200:
 *         description: Query history retrieved successfully
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get(
  '/history',
  [
    q('project_id').isUUID(),
    q('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    q('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  authorizeProject('user'),
  async (req, res) => {
    try {
      const { project_id } = req.query;
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;

      const history = await Project.relatedQuery('query_history')
        .for(project_id)
        .orderBy('created_at', 'DESC')
        .limit(limit)
        .offset(offset)
        .withGraphFetched('user');

      const total = await Project.relatedQuery('query_history')
        .for(project_id)
        .resultSize();

      res.json({
        success: true,
        data: history.map(item => ({
          id: item.id,
          query: item.query,
          params: item.params,
          created_at: item.created_at,
          user: item.user ? {
            id: item.user.id,
            email: item.user.email,
            name: `${item.user.first_name} ${item.user.last_name}`.trim(),
          } : null,
          metadata: item.result_metadata,
        })),
        meta: {
          total,
          limit,
          offset,
        },
      });
    } catch (error) {
      console.error('Get query history error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch query history',
      });
    }
  }
);

export default router;
