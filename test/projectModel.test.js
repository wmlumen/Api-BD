const { expect } = require('chai');
const { v4: uuidv4 } = require('uuid');
const { Project, ProjectTemplate, ProjectMember, ProjectActivity, ProjectVersion } = require('../src/models');
const { setupDatabase, teardownDatabase } = require('./testUtils');

describe('Project Models', () => {
  let testUser;
  let testTemplate;
  let testProject;

  before(async () => {
    await setupDatabase();
    
    // Create a test user
    testUser = {
      id: uuidv4(),
      email: 'test@example.com',
      name: 'Test User',
      password: 'password123',
      is_active: true,
      is_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Create a test template
    testTemplate = await ProjectTemplate.query().insert({
      id: uuidv4(),
      name: 'Test Template',
      description: 'A test project template',
      created_by: testUser.id,
      version: '1.0.0',
      settings: {
        theme: 'dark',
        language: 'es',
        timezone: 'America/Santiago'
      },
      metadata: {
        category: 'test',
        tags: ['test', 'template']
      }
    });
  });

  after(async () => {
    await teardownDatabase();
  });

  describe('Project Creation', () => {
    it('should create a new project from a template', async () => {
      testProject = await Project.createFromTemplate(
        testTemplate.id,
        testUser.id,
        {
          name: 'Test Project',
          description: 'A test project created from template',
          settings: {
            theme: 'light' // Override template setting
          }
        }
      );

      expect(testProject).to.be.an('object');
      expect(testProject.name).to.equal('Test Project');
      expect(testProject.template_id).to.equal(testTemplate.id);
      expect(testProject.settings.theme).to.equal('light'); // Should override template
      expect(testProject.metadata.created_from_template).to.be.true;
    });
  });

  describe('Project Members', () => {
    it('should add a member to the project', async () => {
      const member = await testProject.addMember(testUser.id, 'admin', testUser.id);
      expect(member).to.have.property('role', 'admin');
    });

    it('should check user role in project', async () => {
      const hasAdminRole = await testProject.userHasRole(testUser.id, 'admin');
      expect(hasAdminRole).to.be.true;
    });

    it('should not allow removing the last admin', async () => {
      try {
        await testProject.removeMember(testUser.id);
        throw new Error('Should not allow removing the last admin');
      } catch (error) {
        expect(error.message).to.include('No se puede eliminar al último administrador');
      }
    });
  });

  describe('Project Activities', () => {
    it('should log an activity', async () => {
      const activity = await testProject.logActivity(
        testUser.id,
        'create',
        'query',
        '123',
        { query_name: 'Test Query' }
      );

      expect(activity).to.have.property('action', 'create');
      expect(activity).to.have.property('entity_type', 'query');
    });

    it('should get project activity feed', async () => {
      const activities = await testProject.getActivityFeed();
      expect(activities).to.be.an('array');
      expect(activities[0]).to.have.property('action', 'create');
    });
  });

  describe('Project Versions', () => {
    it('should create a new version', async () => {
      const version = await testProject.createVersion(
        testUser.id,
        'v1.0.0',
        'Initial version'
      );

      expect(version).to.have.property('name', 'v1.0.0');
      expect(version).to.have.property('description', 'Initial version');
      expect(version.data).to.have.property('project');
    });
  });

  describe('Project Export/Import', () => {
    it('should export project data', async () => {
      const exportData = await testProject.exportProject({ includeData: true });
      expect(exportData).to.have.property('project');
      expect(exportData).to.have.property('members');
      expect(exportData).to.have.property('activities');
      expect(exportData).to.have.property('versions');
    });
  });
});
