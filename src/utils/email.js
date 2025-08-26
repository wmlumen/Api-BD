import nodemailer from 'nodemailer';
import { logger } from './logger.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Email template directory
const templatesDir = path.join(__dirname, '../../email-templates');

// Load and compile email templates
const templates = {};

// Load all templates from the templates directory
const loadTemplates = async () => {
  try {
    const templateFiles = fs.readdirSync(templatesDir);
    
    for (const file of templateFiles) {
      if (file.endsWith('.hbs')) {
        const templateName = path.basename(file, '.hbs');
        const templatePath = path.join(templatesDir, file);
        const templateContent = fs.readFileSync(templatePath, 'utf8');
        
        // Compile the template
        templates[templateName] = Handlebars.compile(templateContent);
      }
    }
    
    logger.info(`Loaded ${Object.keys(templates).length} email templates`);
  } catch (error) {
    logger.error('Error loading email templates:', error);
  }
};

// Initialize email transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  tls: {
    // Do not fail on invalid certs
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

// Verify connection configuration
transporter.verify((error) => {
  if (error) {
    logger.error('Error connecting to email server:', error);
  } else {
    logger.info('Email server connection established');
  }
});

// Default sender email
const defaultFrom = `"${process.env.EMAIL_FROM_NAME || 'Multi-Project API'}" <${process.env.EMAIL_FROM || 'noreply@example.com'}>`;

/**
 * Send an email
 * @param {Object} options - Email options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text email body
 * @param {string} [options.html] - HTML email body
 * @param {string} [options.template] - Template name (without .hbs extension)
 * @param {Object} [options.context] - Template context data
 * @param {string|string[]} [options.cc] - CC email address(es)
 * @param {string|string[]} [options.bcc] - BCC email address(es)
 * @param {string} [options.from] - Sender email address
 * @param {Object[]} [options.attachments] - Email attachments
 * @returns {Promise<Object>} Result of the email sending operation
 */
export const sendEmail = async (options) => {
  try {
    const {
      to,
      subject,
      text,
      html,
      template,
      context = {},
      cc,
      bcc,
      from = defaultFrom,
      attachments,
    } = options;

    // If template is provided, render it
    let htmlContent = html;
    if (template) {
      if (!templates[template]) {
        throw new Error(`Email template '${template}' not found`);
      }
      
      // Add common variables to the template context
      const templateContext = {
        ...context,
        year: new Date().getFullYear(),
        appName: process.env.APP_NAME || 'Multi-Project API',
        appUrl: process.env.APP_URL || 'https://example.com',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
      };
      
      htmlContent = templates[template](templateContext);
    }

    const mailOptions = {
      from,
      to,
      subject,
      text,
      html: htmlContent,
      cc,
      bcc,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    
    logger.info(`Email sent to ${to} with message ID: ${info.messageId}`);
    
    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (error) {
    logger.error('Error sending email:', error);
    
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }
};

/**
 * Send a verification email to a new user
 * @param {string} to - Recipient email address
 * @param {string} name - User's name
 * @param {string} token - Verification token
 * @returns {Promise<Object>} Result of the email sending operation
 */
export const sendVerificationEmail = async (to, name, token) => {
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${token}`;
  
  return sendEmail({
    to,
    subject: 'Verify Your Email Address',
    template: 'verify-email',
    context: {
      name,
      verificationUrl,
      token,
    },
  });
};

/**
 * Send a password reset email
 * @param {string} to - Recipient email address
 * @param {string} name - User's name
 * @param {string} token - Password reset token
 * @returns {Promise<Object>} Result of the email sending operation
 */
export const sendPasswordResetEmail = async (to, name, token) => {
  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
  
  return sendEmail({
    to,
    subject: 'Reset Your Password',
    template: 'password-reset',
    context: {
      name,
      resetUrl,
      token,
    },
  });
};

/**
 * Send an invitation email to join a project
 * @param {string} to - Recipient email address
 * @param {string} inviterName - Name of the person sending the invitation
 * @param {string} projectName - Name of the project
 * @param {string} role - Role being offered (user, editor, admin)
 * @param {string} [acceptUrl] - URL to accept the invitation
 * @returns {Promise<Object>} Result of the email sending operation
 */
export const sendProjectInvitation = async (to, inviterName, projectName, role, acceptUrl = null) => {
  return sendEmail({
    to,
    subject: `You've been invited to join a project: ${projectName}`,
    template: 'project-invitation',
    context: {
      inviterName,
      projectName,
      role,
      acceptUrl: acceptUrl || `${process.env.APP_URL || 'http://localhost:3000'}/projects/invitations`,
    },
  });
};

// Load templates when this module is imported
loadTemplates().catch(error => {
  logger.error('Failed to load email templates:', error);
});

// Register handlebars helpers
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('neq', (a, b) => a !== b);
Handlebars.registerHelper('date', (date) => new Date(date).toLocaleDateString());
Handlebars.registerHelper('time', (date) => new Date(date).toLocaleTimeString());
Handlebars.registerHelper('datetime', (date) => new Date(date).toLocaleString());

// Export the transporter in case it's needed directly
export { transporter };
