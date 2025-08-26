import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { Project, ProjectDatabase } from '../models/index.js';
import { authenticate, authorizeProject, projectContext } from '../middleware/auth.js';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @swagger
 * /api/v1/projects:
 *   get:
 *     summary: Get all projects for the current user
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of projects
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const projects = await req.user.$relatedQuery('projects');
    res.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects',
    });
  }
});

/**
 * @swagger
 * /api/v1/projects/{id}:
 *   get:
 *     summary: Get project by ID
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project details
 *       403:
 *         description: Access denied
 *       404:
 *         description: Project not found
 *       500:
 *         description: Server error
 */
router.get(
  '/:id',
  [
    param('id').isUUID(),
  ],
  authorizeProject('user'),
  async (req, res) => {
    try {
      const project = await Project.query()
        .findById(req.params.id)
        .withGraphFetched({
          members: true,
          databases: true,
        });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found',
        });
      }

      res.json({
        success: true,
        data: project,
      });
    } catch (error) {
      console.error('Get project error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch project',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/projects:
 *   post:
 *     summary: Create a new project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               is_public:
 *                 type: boolean
 *               settings:
 *                 type: object
 *     responses:
 *       201:
 *         description: Project created successfully
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Project name is required'),
    body('description').optional().trim(),
    body('is_public').optional().isBoolean().toBoolean(),
    body('settings').optional().isObject(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { name, description, is_public = false, settings = {} } = req.body;

      // Start a transaction
      const trx = await Project.startTransaction();

      try {
        // Create project
        const project = await Project.query(trx).insert({
          name,
          description,
          is_public,
          settings,
          created_by: req.user.id,
        });

        // Add creator as admin
        await project.$relatedQuery('members', trx).insert({
          user_id: req.user.id,
          role: 'admin',
          added_by: req.user.id,
        });

        await trx.commit();

        res.status(201).json({
          success: true,
          data: project,
        });
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Create project error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create project',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/projects/{id}:
 *   put:
 *     summary: Update a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               is_public:
 *                 type: boolean
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: Project updated successfully
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Project not found
 *       500:
 *         description: Server error
 */
router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('is_public').optional().isBoolean().toBoolean(),
    body('settings').optional().isObject(),
  ],
  authorizeProject('admin'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const updates = req.body;

      const project = await Project.query().patchAndFetchById(id, {
        ...updates,
        updated_at: new Date().toISOString(),
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          error: 'Project not found',
        });
      }

      res.json({
        success: true,
        data: project,
      });
    } catch (error) {
      console.error('Update project error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update project',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/projects/{id}/databases:
 *   post:
 *     summary: Add a database to a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - connection_config
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [postgresql, mysql, mongodb, sqlite, mssql]
 *               connection_config:
 *                 type: object
 *               is_primary:
 *                 type: boolean
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Database added successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  '/:id/databases',
  [
    param('id').isUUID(),
    body('name').trim().notEmpty(),
    body('description').optional().trim(),
    body('type').isIn(['postgresql', 'mysql', 'mongodb', 'sqlite', 'mssql']),
    body('connection_config').isObject(),
    body('is_primary').optional().isBoolean().toBoolean(),
    body('metadata').optional().isObject(),
  ],
  authorizeProject('admin'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { id: projectId } = req.params;
      const { is_primary, ...dbData } = req.body;

      // Start transaction
      const trx = await Project.startTransaction();

      try {
        // If this is set as primary, unset any existing primary
        if (is_primary) {
          await ProjectDatabase.query(trx)
            .patch({ is_primary: false })
            .where('project_id', projectId)
            .where('is_primary', true);
        }

        // Create the database
        const database = await ProjectDatabase.query(trx).insert({
          ...dbData,
          project_id: projectId,
          is_primary: is_primary || false,
          created_by: req.user.id,
        });

        await trx.commit();

        res.status(201).json({
          success: true,
          data: database,
        });
      } catch (error) {
        await trx.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Add database error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add database to project',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/projects/{id}/members:
 *   get:
 *     summary: Get project members
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     responses:
 *       200:
 *         description: List of project members
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */
router.get(
  '/:id/members',
  [param('id').isUUID()],
  authorizeProject('user'),
  async (req, res) => {
    try {
      const members = await Project.relatedQuery('members')
        .for(req.params.id)
        .withGraphFetched('user');

      res.json({
        success: true,
        data: members.map(member => ({
          id: member.user.id,
          email: member.user.email,
          first_name: member.user.first_name,
          last_name: member.user.last_name,
          role: member.role,
          added_at: member.created_at,
        })),
      });
    } catch (error) {
      console.error('Get members error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch project members',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/projects/{id}/members:
 *   post:
 *     summary: Add a member to a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - role
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *               role:
 *                 type: string
 *                 enum: [user, editor, admin]
 *     responses:
 *       201:
 *         description: Member added successfully
 *       400:
 *         description: Validation error or user already a member
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */
router.post(
  '/:id/members',
  [
    param('id').isUUID(),
    body('user_id').isUUID(),
    body('role').isIn(['user', 'editor', 'admin']),
  ],
  authorizeProject('admin'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { id: projectId } = req.params;
      const { user_id, role } = req.body;

      // Check if user is already a member
      const existingMember = await Project.relatedQuery('members')
        .for(projectId)
        .where('user_id', user_id)
        .first();

      if (existingMember) {
        return res.status(400).json({
          success: false,
          error: 'User is already a member of this project',
        });
      }

      // Add user to project
      await Project.relatedQuery('members')
        .for(projectId)
        .insert({
          user_id,
          role,
          added_by: req.user.id,
        });

      res.status(201).json({
        success: true,
        message: 'Member added successfully',
      });
    } catch (error) {
      console.error('Add member error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add member to project',
      });
    }
  }
);

/**
 * @swagger
 * /api/v1/projects/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member from a project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to remove
 *     responses:
 *       200:
 *         description: Member removed successfully
 *       400:
 *         description: Cannot remove last admin or self
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Member not found
 *       500:
 *         description: Server error
 */
router.delete(
  '/:id/members/:userId',
  [
    param('id').isUUID(),
    param('userId').isUUID(),
  ],
  authorizeProject('admin'),
  async (req, res) => {
    try {
      const { id: projectId, userId } = req.params;

      // Prevent removing self
      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'You cannot remove yourself from the project',
        });
      }

      // Check if user is the last admin
      const admins = await Project.relatedQuery('members')
        .for(projectId)
        .where('role', 'admin');

      if (admins.length <= 1 && admins[0]?.user_id === userId) {
        return res.status(400).json({
          success: false,
          error: 'Cannot remove the last admin from the project',
        });
      }

      // Remove member
      const deleted = await Project.relatedQuery('members')
        .for(projectId)
        .where('user_id', userId)
        .delete();

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Member not found in this project',
        });
      }

      res.json({
        success: true,
        message: 'Member removed successfully',
      });
    } catch (error) {
      console.error('Remove member error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove member from project',
      });
    }
  }
);

export default router;
